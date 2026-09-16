import { execFileSync, execSync } from "node:child_process"
import { randomBytes } from "node:crypto"

import type { IFileModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

const container = `soko-private-media-${randomBytes(4).toString("hex")}`
const accessKey = "soko-test-access"
const secretKey = "soko-test-secret-key"
const bucket = "soko-listing-media"
const image = "quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z"
const configuredKeys = [
  "S3_FILE_URL",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ENDPOINT",
] as const
const previousEnvironment = Object.fromEntries(
  configuredKeys.map((key) => [key, process.env[key]]),
)

execFileSync("docker", [
  "run",
  "-d",
  "--rm",
  "--name",
  container,
  "-p",
  "127.0.0.1::9000",
  "-e",
  `MINIO_ROOT_USER=${accessKey}`,
  "-e",
  `MINIO_ROOT_PASSWORD=${secretKey}`,
  image,
  "server",
  "/data",
], { stdio: "ignore" })

const port = execFileSync("docker", ["port", container, "9000/tcp"], {
  encoding: "utf8",
}).trim().split(":").pop()
if (!port) {
  throw new Error("MinIO did not publish its S3 port")
}

const endpoint = `http://127.0.0.1:${port}`
execSync(
  `for attempt in $(seq 1 60); do curl -fsS ${endpoint}/minio/health/ready >/dev/null && exit 0; sleep 1; done; exit 1`,
  { stdio: "ignore" },
)
execFileSync("docker", ["exec", container, "mkdir", "-p", `/data/${bucket}`])

process.env.S3_FILE_URL = `${endpoint}/${bucket}`
process.env.S3_ACCESS_KEY_ID = accessKey
process.env.S3_SECRET_ACCESS_KEY = secretKey
process.env.S3_REGION = "us-east-1"
process.env.S3_BUCKET = bucket
process.env.S3_ENDPOINT = endpoint

jest.setTimeout(120000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    afterAll(() => {
      execFileSync("docker", ["stop", container], { stdio: "ignore" })
      for (const key of configuredKeys) {
        const previous = previousEnvironment[key]
        if (previous === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = previous
        }
      }
    })

    it("media_is_served_from_the_private_store_by_signed_url_test", async () => {
      const files = getContainer().resolve<IFileModuleService>(Modules.FILE)
      const content = Buffer.from("real private listing image bytes")
      const uploaded = await files.createFiles({
        filename: "listing.jpg",
        mimeType: "image/jpeg",
        access: "private",
        content: content.toString("base64"),
      })

      expect(uploaded.url).toMatch(new RegExp(`^${endpoint}/${bucket}/`))
      expect(uploaded.url).not.toContain("X-Amz-Signature")

      const unsigned = await fetch(uploaded.url)
      expect(unsigned.status).toBe(403)

      const retrieved = await files.retrieveFile(uploaded.id)
      const signed = new URL(retrieved.url)
      expect(signed.searchParams.get("X-Amz-Expires")).toBe("300")
      expect(signed.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/)

      const response = await fetch(retrieved.url)
      expect(response.status).toBe(200)
      await expect(response.arrayBuffer()).resolves.toEqual(
        content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
      )
    })
  },
})
