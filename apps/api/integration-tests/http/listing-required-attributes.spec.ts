import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import {
  adminHeaders,
  createAdminUser,
} from "../../../../integration-tests/helpers/create-admin-user"

jest.setTimeout(120000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, dbConnection, getContainer }) => {
    it("a_listing_without_required_category_attributes_cannot_go_live_test", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())

      const categoryResponse = await api.post(
        "/admin/product-categories",
        { name: "Required attributes category" },
        adminHeaders,
      )
      expect(categoryResponse.status).toBe(200)
      const categoryId = categoryResponse.data.product_category.id as string

      const attributeResponse = await api.post(
        "/admin/product-attributes",
        {
          name: "Country of origin",
          type: "text",
          is_required: true,
          category_ids: [categoryId],
        },
        adminHeaders,
      )
      expect(attributeResponse.status).toBe(200)

      const productResponse = await api.post(
        "/admin/products",
        {
          title: "Incomplete listing",
          status: "proposed",
          categories: [{ id: categoryId }],
        },
        adminHeaders,
      )
      expect(productResponse.status).toBe(200)
      const productId = productResponse.data.product.id as string

      const confirmation = await api
        .post(`/admin/products/${productId}/confirm`, {}, adminHeaders)
        .catch((error) => error.response)

      expect(confirmation.status).toBe(400)
      expect(confirmation.data.message).toContain(
        "Missing required category attributes: Country of origin",
      )

      const persisted = await api.get(
        `/admin/products/${productId}`,
        adminHeaders,
      )
      expect(persisted.status).toBe(200)
      expect(persisted.data.product.status).toBe("proposed")
    })
  },
})
