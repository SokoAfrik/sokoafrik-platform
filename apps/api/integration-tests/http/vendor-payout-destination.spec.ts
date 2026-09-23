import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"
import {
  adminHeaders,
  createAdminUser,
} from "../../../../integration-tests/helpers/create-admin-user"

jest.setTimeout(180000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer, dbConnection }) => {
    describe("Vendor payout destination", () => {
      beforeEach(async () => {
        const moneyDb = path.resolve(process.cwd(), "../../../soko-money/db")
        for (const migration of readdirSync(moneyDb).filter((file) => file.endsWith(".sql")).sort()) {
          await dbConnection.raw(readFileSync(path.join(moneyDb, migration), "utf8"))
        }
      })

      it("vendor_can_create_one_bank_payout_destination_test", async () => {
        const container = getContainer()
        const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const caller = await createSellerUser(container, {
          email: "payout-destination-caller@sokoafrik.test",
          name: "Payout Destination Caller",
        })
        const other = await createSellerUser(container, {
          email: "payout-destination-other@sokoafrik.test",
          name: "Payout Destination Other",
        })
        const [callerIdentity] = await db("vendor_identity")
          .insert({ seller_id: caller.seller.id })
          .returning("vendor_id")
        const [otherIdentity] = await db("vendor_identity")
          .insert({ seller_id: other.seller.id })
          .returning("vendor_id")
        await db("vendor_profiles").insert([
          {
            vendor_id: callerIdentity.vendor_id,
            business_name: "Caller Shop",
            contact_phone: "+252611000301",
          },
          {
            vendor_id: otherIdentity.vendor_id,
            business_name: "Other Shop",
            contact_phone: "+252611000302",
          },
        ])

        const payload = {
          bank_name: "Premier Bank",
          bank_account_no: "CALLER-001",
          bank_account_name: "Caller Shop",
          swift: "PRMRSOSM",
          party_id: otherIdentity.vendor_id,
        }
        const created = await api.post(
          "/vendor/payout-destination",
          payload,
          caller.headers,
        )

        expect(created.status).toBe(201)
        expect(created.data.payout_destination).toEqual(expect.objectContaining({
          bank_name: "Premier Bank",
          bank_account_no: "CALLER-001",
          bank_account_name: "Caller Shop",
          swift: "PRMRSOSM",
        }))

        const rows = await db("payees")
          .select(
            "party_type",
            "party_id",
            "msisdn",
            "destination",
            "bank_account_no",
            "bank_verified_at",
          )
          .orderBy("id")
        expect(rows).toEqual([expect.objectContaining({
          party_type: "vendor",
          party_id: callerIdentity.vendor_id,
          msisdn: "+252611000301",
          destination: "bank_account",
          bank_account_no: "CALLER-001",
          bank_verified_at: null,
        })])

        const duplicate = await api.post(
          "/vendor/payout-destination",
          {
            bank_name: "Salaam Bank",
            bank_account_no: "CALLER-002",
            bank_account_name: "Caller Shop",
          },
          {
            ...caller.headers,
            validateStatus: () => true,
          },
        )

        expect(duplicate.status).toBe(400)
        expect(duplicate.data.message).toBe(
          "A payout destination already exists for this vendor",
        )
        expect(await db("payees").where({
          party_type: "vendor",
          party_id: callerIdentity.vendor_id,
        }).count("id AS count").first()).toEqual({ count: "1" })
      })

      it("vendor_can_verify_own_bank_payout_destination_test", async () => {
        const container = getContainer()
        const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const caller = await createSellerUser(container, {
          email: "bank-verification-caller@sokoafrik.test",
          name: "Bank Verification Caller",
        })
        const other = await createSellerUser(container, {
          email: "bank-verification-other@sokoafrik.test",
          name: "Bank Verification Other",
        })
        const [callerIdentity] = await db("vendor_identity")
          .insert({ seller_id: caller.seller.id })
          .returning("vendor_id")
        const [otherIdentity] = await db("vendor_identity")
          .insert({ seller_id: other.seller.id })
          .returning("vendor_id")
        await db("vendor_profiles").insert([
          {
            vendor_id: callerIdentity.vendor_id,
            business_name: "Verification Caller Shop",
            contact_phone: "+252611000311",
          },
          {
            vendor_id: otherIdentity.vendor_id,
            business_name: "Verification Other Shop",
            contact_phone: "+252611000312",
          },
        ])

        await api.post(
          "/vendor/payout-destination",
          {
            bank_name: "Premier Bank",
            bank_account_no: "VERIFY-001",
            bank_account_name: "Verification Caller Shop",
            swift: "PRMRSOSM",
          },
          caller.headers,
        )

        const issued = await api.post(
          "/vendor/payout-destination/verify",
          { payee_id: otherIdentity.vendor_id },
          caller.headers,
        )
        expect(issued.status).toBe(201)
        expect(issued.data.verification).toEqual(expect.objectContaining({
          status: "staged",
          amount_minor: 5,
          currency: "USD",
        }))
        expect(issued.data.verification).not.toHaveProperty("code")

        const staged = await db("bank_verifications as bv")
          .join("payees as p", "p.id", "bv.payee_id")
          .select(
            "bv.id",
            "bv.code",
            "bv.amount_minor",
            "bv.sent_at",
            "bv.expires_at",
            "bv.bank_name_at_issue",
            "bv.bank_account_no_at_issue",
            "bv.bank_account_name_at_issue",
            "bv.bank_swift_at_issue",
            "p.party_id",
          )
          .first()
        expect(staged).toEqual(expect.objectContaining({
          amount_minor: "5",
          bank_name_at_issue: "Premier Bank",
          bank_account_no_at_issue: "VERIFY-001",
          bank_account_name_at_issue: "Verification Caller Shop",
          bank_swift_at_issue: "PRMRSOSM",
          party_id: callerIdentity.vendor_id,
        }))
        expect(staged.sent_at).toBeInstanceOf(Date)
        expect(staged.expires_at).toBeInstanceOf(Date)
        expect(staged.code).toMatch(/^[ACDEFGHJKLMNPQRTUVWXY2346789]{6}$/)

        const stolen = await api.post(
          "/vendor/payout-destination/verify",
          { code: staged.code },
          { ...other.headers, validateStatus: () => true },
        )
        expect(stolen.status).toBe(404)

        const verified = await api.post(
          "/vendor/payout-destination/verify",
          { code: ` ${String(staged.code).toLowerCase()} ` },
          caller.headers,
        )
        expect(verified.status).toBe(200)
        expect(verified.data.verification).toEqual({
          id: String(staged.id),
          status: "verified",
        })

        const destination = await db("payees")
          .select("bank_verified_at", "bank_verified_by")
          .where({ party_type: "vendor", party_id: callerIdentity.vendor_id })
          .first()
        expect(destination.bank_verified_at).toBeInstanceOf(Date)
        expect(destination.bank_verified_by).toBe("micro_deposit")

        const verification = await db("bank_verifications")
          .select("verified_at")
          .where("id", staged.id)
          .first()
        expect(verification.verified_at).toBeInstanceOf(Date)
      })

      it("admin_can_list_staged_bank_verifications_test", async () => {
        const container = getContainer()
        const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await createAdminUser(dbConnection, adminHeaders, container, {
          email: "bank-verification-operator@sokoafrik.test",
        })
        const vendor = await createSellerUser(container, {
          email: "bank-verification-listing@sokoafrik.test",
          name: "Bank Verification Listing",
        })
        const [identity] = await db("vendor_identity")
          .insert({ seller_id: vendor.seller.id })
          .returning("vendor_id")
        await db("vendor_profiles").insert({
          vendor_id: identity.vendor_id,
          business_name: "Listing Shop",
          contact_phone: "+252611000313",
        })

        await api.post(
          "/vendor/payout-destination",
          {
            bank_name: "Premier Bank",
            bank_account_no: "STAGED-001",
            bank_account_name: "Listing Shop",
            swift: "PRMRSOSM",
          },
          vendor.headers,
        )
        await api.post(
          "/vendor/payout-destination/verify",
          {},
          vendor.headers,
        )

        const staged = await db("bank_verifications").select("id", "code").first()
        const unauthenticated = await api.get("/admin/bank-verifications", {
          validateStatus: () => true,
        })
        expect(unauthenticated.status).toBe(401)

        const response = await api.get("/admin/bank-verifications", adminHeaders)
        expect(response.status).toBe(200)
        expect(response.data.bank_verifications).toEqual([
          expect.objectContaining({
            id: String(staged.id),
            vendor_id: identity.vendor_id,
            amount_minor: 5,
            currency: "USD",
            bank_name: "Premier Bank",
            bank_account_no: "STAGED-001",
            bank_account_name: "Listing Shop",
            swift: "PRMRSOSM",
          }),
        ])
        expect(response.data.bank_verifications[0]).not.toHaveProperty("code")

        await api.post(
          "/vendor/payout-destination/verify",
          { code: staged.code },
          vendor.headers,
        )
        const afterVerification = await api.get(
          "/admin/bank-verifications",
          adminHeaders,
        )
        expect(afterVerification.data.bank_verifications).toEqual([])
      })

      it("vendor_can_request_only_available_balance_once_test", async () => {
        const container = getContainer()
        const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const caller = await createSellerUser(container, {
          email: "withdrawal-caller@sokoafrik.test",
          name: "Withdrawal Caller",
        })
        const other = await createSellerUser(container, {
          email: "withdrawal-other@sokoafrik.test",
          name: "Withdrawal Other",
        })
        const [callerIdentity] = await db("vendor_identity")
          .insert({ seller_id: caller.seller.id })
          .returning("vendor_id")
        const [otherIdentity] = await db("vendor_identity")
          .insert({ seller_id: other.seller.id })
          .returning("vendor_id")
        await db("vendor_profiles").insert([
          {
            vendor_id: callerIdentity.vendor_id,
            business_name: "Withdrawal Caller Shop",
            contact_phone: "+252611000321",
          },
          {
            vendor_id: otherIdentity.vendor_id,
            business_name: "Withdrawal Other Shop",
            contact_phone: "+252611000322",
          },
        ])

        const [callerPayee] = await db("payees").insert({
          party_type: "vendor",
          party_id: callerIdentity.vendor_id,
          msisdn: "+252611000321",
          network: "EVC_PLUS",
          account_holder: "Withdrawal Caller Shop",
          destination: "bank_account",
          bank_name: "Premier Bank",
          bank_account_no: "WITHDRAW-001",
          bank_account_name: "Withdrawal Caller Shop",
          bank_verified_at: db.fn.now(),
          bank_verified_by: "micro_deposit",
        }).returning("id")
        await db("payees").insert({
          party_type: "vendor",
          party_id: otherIdentity.vendor_id,
          msisdn: "+252611000322",
          network: "EVC_PLUS",
          account_holder: "Withdrawal Other Shop",
          destination: "bank_account",
          bank_name: "Premier Bank",
          bank_account_no: "WITHDRAW-002",
          bank_account_name: "Withdrawal Other Shop",
          bank_verified_at: db.fn.now(),
          bank_verified_by: "micro_deposit",
        })

        const accounts = await db("ledger_accounts").insert([
          { kind: "platform_float", owner_type: "platform", owner_id: null, currency: "USD" },
          { kind: "vendor_available", owner_type: "vendor", owner_id: callerIdentity.vendor_id, currency: "USD" },
        ]).returning(["id", "kind"])
        const platformFloat = accounts.find((account: any) => account.kind === "platform_float")
        const vendorAvailable = accounts.find((account: any) => account.kind === "vendor_available")
        const transferId = "aec1b8ff-69ec-47b5-9527-aab899df4da8"
        await db("ledger_transfers").insert({ transfer_id: transferId })
        await db("ledger_entries").insert([
          {
            transfer_id: transferId,
            account_id: platformFloat.id,
            amount_minor: 1750,
            currency: "USD",
            reason: "release",
          },
          {
            transfer_id: transferId,
            account_id: vendorAvailable.id,
            amount_minor: -1750,
            currency: "USD",
            reason: "release",
          },
        ])
        const legs = await db("ledger_entries")
          .select("account_id", db.raw("amount_minor::text AS amount_minor"))
          .where("transfer_id", transferId)
          .orderBy("account_id")
        expect(legs).toEqual([
          expect.objectContaining({ amount_minor: "1750" }),
          expect.objectContaining({ amount_minor: "-1750" }),
        ])
        expect(legs.reduce(
          (sum: bigint, leg: any) => sum + BigInt(leg.amount_minor),
          0n,
        )).toBe(0n)

        const created = await api.post(
          "/vendor/withdrawals",
          {
            amount_minor: 1200,
            currency: "usd",
            payee_id: "spoofed-payee",
          },
          caller.headers,
        )
        expect(created.status).toBe(201)
        expect(created.data.withdrawal).toEqual(expect.objectContaining({
          amount_minor: 1200,
          currency: "USD",
          status: "requested",
        }))

        const saved = await db("withdrawal_requests")
          .select(
            db.raw("payee_id::text AS payee_id"),
            db.raw("amount_minor::text AS amount_minor"),
            "currency",
            "status",
            "requested_by",
          )
          .first()
        expect(saved).toEqual({
          payee_id: String(callerPayee.id),
          amount_minor: "1200",
          currency: "USD",
          status: "requested",
          requested_by: "vendor_web",
        })

        const duplicate = await api.post(
          "/vendor/withdrawals",
          { amount_minor: 100, currency: "USD" },
          { ...caller.headers, validateStatus: () => true },
        )
        expect(duplicate.status).toBe(400)
        expect(duplicate.data.message).toBe(
          "A withdrawal request is already open for this vendor",
        )

        const uncovered = await api.post(
          "/vendor/withdrawals",
          { amount_minor: 1, currency: "USD" },
          { ...other.headers, validateStatus: () => true },
        )
        expect(uncovered.status).toBe(400)
        expect(uncovered.data.message).toBe(
          "Withdrawal amount exceeds the available vendor balance",
        )
        expect(await db("withdrawal_requests").count("id AS count").first())
          .toEqual({ count: "1" })
      })
    })
  },
})
