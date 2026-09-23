import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"

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
    })
  },
})
