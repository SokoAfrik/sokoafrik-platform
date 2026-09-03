import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, dbConnection }) => {
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
    })
  },
})
