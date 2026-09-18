import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

jest.setTimeout(180000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, dbConnection }) => {
    describe("public admin registration", () => {
      it("public_admin_registration_is_refused_test", async () => {
        const email = "public-admin-attempt@sokoafrik.test"
        const before = await dbConnection.raw(`
          SELECT
            (SELECT count(*)::int FROM "user" WHERE email = ?) AS users,
            (SELECT count(*)::int FROM provider_identity WHERE entity_id = ?) AS identities
        `, [email, email])

        const responses = await Promise.all([
          api.post("/admin/users", {
            email,
            first_name: "Public",
            last_name: "Admin",
          }).catch((error) => error.response),
          api.post("/admin/invites/accept", {
            token: "not-an-invite",
            email,
            first_name: "Public",
            last_name: "Admin",
          }).catch((error) => error.response),
          api.post("/auth/user/emailpass/register", {
            email,
            password: "attacker-chosen-password",
          }).catch((error) => error.response),
        ])

        expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
        expect(responses[2].data).toEqual(expect.objectContaining({
          message: "Public admin registration is disabled",
        }))

        const after = await dbConnection.raw(`
          SELECT
            (SELECT count(*)::int FROM "user" WHERE email = ?) AS users,
            (SELECT count(*)::int FROM provider_identity WHERE entity_id = ?) AS identities
        `, [email, email])
        expect(after.rows).toEqual(before.rows)
        expect(after.rows).toEqual([{ users: 0, identities: 0 }])
      })
    })
  },
})
