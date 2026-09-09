import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"

jest.setTimeout(180000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer, dbConnection }) => {
    describe("Vendor balance", () => {
      beforeEach(async () => {
        const moneyDb = path.resolve(process.cwd(), "../../../soko-money/db")
        for (const migration of readdirSync(moneyDb).filter((file) => file.endsWith(".sql")).sort()) {
          await dbConnection.raw(readFileSync(path.join(moneyDb, migration), "utf8"))
        }
      })

      it("balance_matches_ledger_view_test", async () => {
        const container = getContainer()
        const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        const sellerA = await createSellerUser(container, {
          email: "vendor-balance-a@sokoafrik.test",
          name: "Vendor Balance A",
        })
        const sellerB = await createSellerUser(container, {
          email: "vendor-balance-b@sokoafrik.test",
          name: "Vendor Balance B",
        })

        const [identityA] = await db("vendor_identity")
          .insert({ seller_id: sellerA.seller.id })
          .returning("vendor_id")
        const [identityB] = await db("vendor_identity")
          .insert({ seller_id: sellerB.seller.id })
          .returning("vendor_id")

        const [payeeA] = await db("payees").insert({
          party_type: "vendor",
          party_id: identityA.vendor_id,
          msisdn: "252611000101",
          network: "EVC_PLUS",
          account_holder: "Vendor Balance A",
          destination: "bank_account",
          bank_name: "Test Bank",
          bank_account_no: "BALANCE-A-001",
          bank_account_name: "Vendor Balance A",
        }).returning("id")
        const [payeeB] = await db("payees").insert({
          party_type: "vendor",
          party_id: identityB.vendor_id,
          msisdn: "252611000102",
          network: "EVC_PLUS",
          account_holder: "Vendor Balance B",
          destination: "bank_account",
          bank_name: "Test Bank",
          bank_account_no: "BALANCE-B-001",
          bank_account_name: "Vendor Balance B",
        }).returning("id")

        const accounts = await db("ledger_accounts").insert([
          { kind: "platform_float", owner_type: "platform", owner_id: null, currency: "USD" },
          { kind: "vendor_available", owner_type: "vendor", owner_id: identityA.vendor_id, currency: "USD" },
          { kind: "vendor_available", owner_type: "vendor", owner_id: identityB.vendor_id, currency: "USD" },
        ]).returning(["id", "kind", "owner_id"])
        const platformFloat = accounts.find((account: any) => account.kind === "platform_float")
        const vendorAvailableA = accounts.find(
          (account: any) => String(account.owner_id) === String(identityA.vendor_id)
        )
        const transferId = "b4eebee0-6d8e-48d5-b761-544867c68be2"
        await db("ledger_transfers").insert({ transfer_id: transferId })
        await db("ledger_entries").insert([
          {
            transfer_id: transferId,
            account_id: platformFloat.id,
            amount_minor: 1750,
            currency: "USD",
            reason: "capture",
          },
          {
            transfer_id: transferId,
            account_id: vendorAvailableA.id,
            amount_minor: -1750,
            currency: "USD",
            reason: "capture",
          },
        ])

        const viewRows = await db("vendor_withdrawable")
          .select(db.raw("payee_id::text AS payee_id"))
          .select(db.raw("available_minor::text AS available_minor"))
          .select("currency", "has_open_request")
          .whereIn("payee_id", [payeeA.id, payeeB.id])
          .orderBy("payee_id")
        expect(viewRows.map((row: any) => row.available_minor)).toEqual(["1750", "0"])

        const responseA = await api.get("/vendor/balance", sellerA.headers)
        const responseB = await api.get("/vendor/balance", sellerB.headers)

        expect(responseA.status).toBe(200)
        expect(responseB.status).toBe(200)
        expect(responseA.data.balance).toEqual({
          available_minor: viewRows[0].available_minor,
          currency: "USD",
          has_open_request: false,
        })
        expect(responseB.data.balance).toEqual({
          available_minor: viewRows[1].available_minor,
          currency: "USD",
          has_open_request: false,
        })
      })
    })
  },
})
