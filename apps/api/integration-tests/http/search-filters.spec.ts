import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import {
  adminHeaders,
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../integration-tests/helpers/create-admin-user"

jest.setTimeout(120000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, dbConnection, getContainer }) => {
    it("filters_narrow_on_category_attributes_not_free_text_test", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
      const publishableKey = await generatePublishableKey(getContainer())
      const storeHeaders = generateStoreHeaders({ publishableKey })

      const createProduct = async (
        title: string,
        handle: string,
        color: "Red" | "Blue",
      ) => {
        const response = await api.post(
          "/admin/products",
          {
            title,
            handle,
            status: "published",
            attributes: [
              {
                title: "Color",
                values: [color],
                is_variant_axis: true,
              },
            ],
            variants: [
              {
                title: `${color} variant`,
                options: { Color: color },
              },
            ],
          },
          adminHeaders,
        )

        expect([200, 201]).toContain(response.status)
        return response.data.product.id as string
      }

      const redAttributeProduct = await createProduct(
        "Plain Linen Dirac",
        "plain-linen-dirac",
        "Red",
      )
      const redTextOnlyProduct = await createProduct(
        "Red Marketing Blue Sandals",
        "red-marketing-blue-sandals",
        "Blue",
      )

      const freeText = await api.get("/store/products", {
        params: { q: "Red" },
        ...storeHeaders,
      })
      expect(freeText.status).toBe(200)
      expect(freeText.data.products.map((product: { id: string }) => product.id))
        .toContain(redTextOnlyProduct)

      const structured = await api.get("/store/products", {
        params: { "attributes[color]": "Red" },
        ...storeHeaders,
      })
      expect(structured.status).toBe(200)
      expect(structured.data.products.map((product: { id: string }) => product.id))
        .toEqual([redAttributeProduct])
      expect(structured.data.products.map((product: { id: string }) => product.id))
        .not.toContain(redTextOnlyProduct)
    })
  },
})
