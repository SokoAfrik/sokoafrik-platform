import { writeFileSync } from "fs"
import { startStack, type Stack } from "../src/stack/stack"
import { STACK_STATE_FILE } from "../src/stack/paths"

// The customer suite. Same stack as the journeys, plus apps/storefront, and
// seeded with the demo catalog because a shop with nothing in it cannot be
// browsed — and because the storefront needs a publishable API key, which only
// the catalog seed creates.
declare global {
  var __SHOP_STACK__: Stack | undefined
  var __SIFALO_STUB__: { url: string; close: () => Promise<void> } | undefined
}

export default async function globalSetup() {
  const getPort = (await import("get-port")).default
  const storefrontPort = await getPort()

  // SIFALO_E2E turns the collection rail on, pointed at a stub gateway. Unset,
  // nothing changes and the suite runs exactly as it did before — which is what
  // makes the difference between the two runs attributable.
  let sifaloStub: { url: string; close: () => Promise<void> } | undefined
  if (process.env.SIFALO_E2E === "1") {
    const { startSifaloStub } = await import("../rails/sifalo-stub")
    sifaloStub = await startSifaloStub({ kind: "echo" })
    process.env.SIFALO_USERNAME = "e2e"
    process.env.SIFALO_KEY = "e2e"
    process.env.SIFALO_BASE_URL = sifaloStub.url
    process.env.SIFALO_CHECKOUT_BASE_URL = `${sifaloStub.url}/checkout/`
    process.env.SIFALO_RETURN_URL = `http://localhost:${storefrontPort}/de/checkout/sifalo-return`
    globalThis.__SIFALO_STUB__ = sifaloStub
    console.log(`\n[shop] sifalo stub up at ${sifaloStub.url}, return -> ${process.env.SIFALO_RETURN_URL}\n`)
  }

  const stack = await startStack({
    seedExec: "./guides/guide-seed-exec.ts",
    withStorefront: true,
    storefrontPort,
  })
  globalThis.__SHOP_STACK__ = stack

  // ENABLE THE RAIL ON THE REGION.
  //
  // A payment provider that is loaded is not yet a payment provider a buyer can
  // choose: Medusa links providers to regions (region_payment_provider), and
  // /store/payment-providers returns only what that region has enabled. In
  // production this is an admin action — "turn this payment method on for this
  // region" — and it is deliberately a decision someone makes rather than a
  // consequence of installing a module. The test performs it explicitly, and
  // says so, rather than letting the rail appear by magic.
  if (process.env.SIFALO_E2E === "1") {
    const { execFileSync } = await import("node:child_process")
    const q = (sql: string) =>
      execFileSync("psql", [stack.db.url, "-tAF|", "-c", sql], { encoding: "utf8" }).trim()

    const providers = q(`select id from payment_provider order by id`)
    console.log(`[shop] payment providers loaded: ${providers.split("\n").join(", ")}`)
    if (!providers.includes("pp_sifalo_sifalo")) {
      throw new Error(
        `the Sifalo provider did not load — payment_provider holds only: ${providers}. ` +
          `A missing provider must fail here, loudly, rather than surfacing three steps later as "the buyer was not offered Sifalo".`
      )
    }

    const linked = q(`
      insert into region_payment_provider (id, region_id, payment_provider_id)
      select 'regpp_sifalo_' || r.id, r.id, 'pp_sifalo_sifalo' from region r
      on conflict do nothing
      returning region_id`)
    console.log(`[shop] sifalo enabled on regions: ${linked.split("\n").filter(Boolean).length}`)
  }
  // The database url goes into the state file too: a test that claims a purchase
  // happened has to be able to read the order back out of the system of record,
  // not just off a redirect. The db is ephemeral and torn down with the stack.
  writeFileSync(
    STACK_STATE_FILE,
    JSON.stringify({ ...stack.urls, databaseUrl: stack.db.url }, null, 2)
  )
  console.log(
    `\n[shop] stack up:\n  medusa:     ${stack.urls.medusa}\n  storefront: ${stack.urls.storefront}\n`
  )
}
