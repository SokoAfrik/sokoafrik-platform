import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import {
  adminHeaders,
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../integration-tests/helpers/create-admin-user"
import { createCustomerUser } from "../../../../integration-tests/helpers/create-customer-user"
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"

jest.setTimeout(180000)

const sensitiveFields = new Set(["password", "password_hash", "passwordHash"])

function findSensitiveFields(value: unknown, path = "$", found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveFields(item, `${path}[${index}]`, found))
    return found
  }

  if (!value || typeof value !== "object") {
    return found
  }

  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveFields.has(key)) {
      found.push(`${path}.${key}`)
    }
    findSensitiveFields(nested, `${path}.${key}`, found)
  }

  return found
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, dbConnection, getContainer }) => {
    describe("API password hash exposure", () => {
      it.each([
        "a_password_hash_reaches_no_client_test",
        "no_api_response_exposes_a_password_hash_test",
      ])("%s", async () => {
        const secretMetadata = JSON.stringify({
          password: "plain-text-must-not-leak",
          password_hash: "$2b$12$must-not-leak",
          passwordHash: "camel-case-must-not-leak",
          safe: "visible",
        })

        const { user } = await createAdminUser(
          dbConnection,
          adminHeaders,
          getContainer(),
          { email: "hash-admin@sokoafrik.test" },
        )
        const sellerUser = await createSellerUser(getContainer(), {
          email: "hash-seller@sokoafrik.test",
          name: "Hash-safe seller",
        })
        const customerUser = await createCustomerUser(getContainer(), {
          email: "hash-customer@sokoafrik.test",
        })
        const publishableKey = await generatePublishableKey(getContainer())
        const storeHeaders = generateStoreHeaders({ publishableKey })

        await dbConnection.raw(
          `UPDATE "user" SET metadata = ?::jsonb WHERE id = ?`,
          [secretMetadata, user.id],
        )
        await dbConnection.raw(
          `UPDATE seller SET metadata = ?::jsonb WHERE id = ?`,
          [secretMetadata, sellerUser.seller.id],
        )
        await dbConnection.raw(
          `UPDATE customer SET metadata = ?::jsonb WHERE id = ?`,
          [secretMetadata, customerUser.customer.id],
        )

        const responses = await Promise.all([
          api.get("/admin/users/me?fields=id,email,metadata", adminHeaders),
          api.get("/vendor/sellers/me?fields=id,email,metadata", sellerUser.headers),
          api.get("/store/customers/me?fields=id,email,metadata", {
            headers: {
              ...storeHeaders.headers,
              ...customerUser.headers.headers,
            },
          }),
        ])

        expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
        expect(responses.map((response) => findSensitiveFields(response.data))).toEqual([
          [],
          [],
          [],
        ])
        for (const response of responses) {
          expect(JSON.stringify(response.data)).toContain('"safe":"visible"')
        }

        const loginErrors = await Promise.all([
          ["user", "hash-admin@sokoafrik.test"],
          ["member", "hash-seller@sokoafrik.test"],
          ["customer", "hash-customer@sokoafrik.test"],
        ].map(async ([actor, email]) => api
          .post(`/auth/${actor}/emailpass`, { email, password: "wrong-password" })
          .catch((error) => error.response)))

        expect(loginErrors.map((response) => response.status)).toEqual([401, 401, 401])
        expect(loginErrors.map((response) => findSensitiveFields(response.data))).toEqual([
          [],
          [],
          [],
        ])
      })
    })
  },
})
