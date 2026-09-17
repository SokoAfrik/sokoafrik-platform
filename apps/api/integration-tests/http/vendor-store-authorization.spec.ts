import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"

jest.setTimeout(120000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    describe("Vendor store authorization", () => {
      it("an_unauthenticated_request_cannot_claim_or_rename_a_vendor_store_test", async () => {
        const sellerName = "Hodan Electronics"
        const { seller } = await createSellerUser(getContainer(), {
          email: "vendor-store-authorization@sokoafrik.test",
          name: sellerName,
        })
        const attacker = await createSellerUser(getContainer(), {
          email: "vendor-store-attacker@sokoafrik.test",
          name: "Attacker Store",
        })

        const anonymous = await api
          .post(`/vendor/sellers/${seller.id}`, {
            name: "Attacker Controlled Store",
            handle: "attacker-controlled-store",
          })
          .catch((error) => error.response)

        expect(anonymous.status).toBe(401)

        const crossVendor = await api
          .post(
            `/vendor/sellers/${seller.id}`,
            {
              name: "Attacker Controlled Store",
              handle: "attacker-controlled-store",
            },
            {
              headers: {
                ...attacker.headers.headers,
                "x-seller-id": seller.id,
              },
            },
          )
          .catch((error) => error.response)

        expect(crossVendor.status).toBe(400)

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: sellers } = await query.graph({
          entity: "seller",
          fields: ["id", "name", "handle"],
          filters: { id: seller.id },
        })

        expect(sellers).toHaveLength(1)
        expect(sellers[0]).toMatchObject({
          id: seller.id,
          name: sellerName,
        })
        expect(sellers[0].handle).not.toBe("attacker-controlled-store")
      })
    })
  },
})
