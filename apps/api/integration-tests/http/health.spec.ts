import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  adminHeaders,
  createAdminUser,
} from "../../../../integration-tests/helpers/create-admin-user"

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
    })
  },
})
