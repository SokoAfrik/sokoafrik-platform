import { spawn } from "child_process"
import { execFileSync } from "child_process"
import { STOREFRONT_DIR } from "./paths"

export interface StorefrontHandle {
  url: string
  port: number
  publishableKey: string
  close: () => Promise<void>
}

interface StartStorefrontOptions {
  port: number
  backendUrl: string
  databaseUrl: string
  region?: string
}

// The storefront is NOT a dashboard. admin and vendor are thin Vite hosts that
// mount a package; this is apps/storefront, a full Next.js app, so it is started
// from its own directory and needs three things the dashboards do not:
//   - MEDUSA_BACKEND_URL, read server-side
//   - NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY, sent as x-publishable-api-key on every
//     store request (src/lib/client.ts and src/middleware.ts). Without it the
//     store API refuses everything and the shop renders empty, which looks like
//     "no products" rather than "not authorised" — so it is read from the seeded
//     database rather than guessed.
//   - NEXT_PUBLIC_DEFAULT_REGION, because prices and shipping are region-scoped.
export function readPublishableKey(databaseUrl: string): string {
  const out = execFileSync(
    "psql",
    [databaseUrl, "-tAc",
     "select token from api_key where type = 'publishable' and revoked_at is null order by created_at limit 1"],
    { encoding: "utf8" }
  ).trim()
  if (!out) {
    throw new Error(
      "no publishable API key in the seeded database — the storefront cannot authenticate to the store API. " +
      "Seed with the catalog seed (apps/api/src/scripts/seed.ts), not the login-only e2e seed."
    )
  }
  return out
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (e) {
      last = String((e as Error).message)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Storefront did not become ready at ${url} within ${timeoutMs}ms (last: ${last})`)
}

export async function startStorefront({
  port,
  backendUrl,
  databaseUrl,
  region = "de",
}: StartStorefrontOptions): Promise<StorefrontHandle> {
  const publishableKey = readPublishableKey(databaseUrl)
  const url = `http://localhost:${port}`

  const child = spawn("bun", ["run", "dev", "--", "--port", String(port)], {
    cwd: STOREFRONT_DIR,
    env: {
      ...process.env,
      MEDUSA_BACKEND_URL: backendUrl,
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_DEFAULT_REGION: region,
      NEXT_PUBLIC_BASE_URL: url,
      NEXT_PUBLIC_SITE_NAME: "SokoAfrik",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  })

  // Next dev compiles on first request, so the readiness budget is larger than
  // the dashboards' — a cold turbopack build of this app is not fast.
  await waitForServer(url, 240_000)

  return { url, port, publishableKey, close: async () => { child.kill("SIGTERM") } }
}
