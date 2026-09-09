import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  adminHeaders,
  createAdminUser,
} from "../../../../integration-tests/helpers/create-admin-user"
import { medusaAuthorization } from "../../../storefront/src/lib/helpers/token"

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, dbConnection, getContainer }) => {
    describe("Ping", () => {
      it("boots Mercur 2.18 against PostgreSQL and serves health", async () => {
        const response = await api.get('/health')
        const database = await dbConnection.raw(
          `SELECT current_setting('server_version') AS server_version,
                  to_regclass('public.seller')::text AS mercur_table`
        )

        expect(response.status).toEqual(200)
        expect(database.rows[0]).toEqual({
          server_version: expect.stringMatching(/^\d+\.\d+/),
          mercur_table: 'seller',
        })
      })

      it("authenticates an admin and protects the current-user endpoint", async () => {
        const email = "admin-auth@sokoafrik.test"
        const password = "somepassword"
        const { user } = await createAdminUser(
          dbConnection,
          adminHeaders,
          getContainer(),
          { email }
        )

        const anonymous = await api
          .get("/admin/users/me")
          .catch((error) => error.response)
        expect(anonymous.status).toEqual(401)

        const invalidLogin = await api
          .post("/auth/user/emailpass", { email, password: "wrong-password" })
          .catch((error) => error.response)
        expect(invalidLogin.status).toEqual(401)

        const login = await api.post("/auth/user/emailpass", { email, password })
        expect(login.status).toEqual(200)
        expect(login.data.token).toEqual(expect.any(String))

        const currentUser = await api.get("/admin/users/me", {
          headers: { authorization: `Bearer ${login.data.token}` },
        })
        expect(currentUser.status).toEqual(200)
        expect(currentUser.data.user).toMatchObject({ id: user.id, email })
      })

      it("auth_token_shape_accepted_by_medusa_test", async () => {
        const email = "app-token-shape@sokoafrik.test"
        const password = "somepassword"
        const { user } = await createAdminUser(
          dbConnection,
          adminHeaders,
          getContainer(),
          { email }
        )

        const login = await api.post("/auth/user/emailpass", { email, password })
        const token = login.data.token

        expect(login.status).toEqual(200)
        expect(token).toEqual(expect.any(String))
        expect(token).not.toMatch(/^Bearer\s/i)
        expect(token.split(".")).toHaveLength(3)

        const rawToken = await api
          .get("/admin/users/me", {
            headers: { authorization: token },
          })
          .catch((error) => error.response)
        expect(rawToken.status).toEqual(401)

        const appShapedToken = await api.get("/admin/users/me", {
          headers: medusaAuthorization(token),
        })
        expect(appShapedToken.status).toEqual(200)
        expect(appShapedToken.data.user).toMatchObject({ id: user.id, email })
      })

      it("auth_token_shape_accepted_by_medusa_test rejects a corrupted app token", async () => {
        const email = "app-token-integrity@sokoafrik.test"
        const password = "somepassword"
        const { user } = await createAdminUser(
          dbConnection,
          adminHeaders,
          getContainer(),
          { email }
        )

        const login = await api.post("/auth/user/emailpass", { email, password })
        const token = login.data.token as string
        const corruptedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`

        const corrupted = await api
          .get("/admin/users/me", {
            headers: medusaAuthorization(corruptedToken),
          })
          .catch((error) => error.response)
        expect(corrupted.status).toEqual(401)

        const genuine = await api.get("/admin/users/me", {
          headers: medusaAuthorization(token),
        })
        expect(genuine.status).toEqual(200)
        expect(genuine.data.user).toMatchObject({ id: user.id, email })
      })
    })
  },
})
