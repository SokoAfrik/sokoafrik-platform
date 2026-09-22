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
    })
  },
})
