import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import {
  adminHeaders,
  createAdminUser,
} from "../../../../integration-tests/helpers/create-admin-user"

jest.setTimeout(180000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, dbConnection, getContainer }) => {
    describe("API upload execution boundary", () => {
      it("an_uploaded_file_must_never_be_executable_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer())

        const executableClaims = [
          { filename: "listing.php", mimeType: "image/jpeg" },
          { filename: "listing.jpg", mimeType: "application/x-httpd-php" },
          { filename: "listing.js", mimeType: "application/javascript" },
          { filename: "listing.sh", mimeType: "application/x-sh" },
        ]

        for (const claim of executableClaims) {
          const form = new FormData()
          form.append(
            "files",
            new Blob(["<?php echo 'executed'; ?>"], { type: claim.mimeType }),
            claim.filename,
          )

          const response = await api
            .post("/admin/uploads", form, adminHeaders)
            .catch((error) => error.response)

          expect(response.status).toBe(400)
          expect(response.data.message).toContain("Only inert listing media may be uploaded")
        }
      })
    })
  },
})
