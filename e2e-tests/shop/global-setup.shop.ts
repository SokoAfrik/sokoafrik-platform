import { writeFileSync } from "fs"
import { execFileSync } from "node:child_process"
import { startStack, type Stack } from "../src/stack/stack"
import { STACK_STATE_FILE } from "../src/stack/paths"
import { readPublishableKey } from "../src/stack/storefront"

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
  //
  // The storefront's port is fixed BEFORE Medusa boots, because a redirect rail
  // is configured with a return URL at boot and Medusa boots first. That is a
  // real property of the rail, not a test artefact.
  if (process.env.SIFALO_E2E === "1") {
    const { startSifaloStub } = await import("../rails/sifalo-stub")
    const stub = await startSifaloStub({ kind: "echo" })
    process.env.SIFALO_USERNAME = "e2e"
    process.env.SIFALO_KEY = "e2e"
    process.env.SIFALO_BASE_URL = stub.url
    process.env.SIFALO_CHECKOUT_BASE_URL = `${stub.url}/checkout/`
    process.env.SIFALO_RETURN_URL = `http://localhost:${storefrontPort}/de/checkout/sifalo-return`
    globalThis.__SIFALO_STUB__ = stub
    console.log(`\n[shop] sifalo stub up at ${stub.url}\n`)
  }

  const stack = await startStack({
    seedExec: "./guides/guide-seed-exec.ts",
    withStorefront: true,
    storefrontPort,
  })
  globalThis.__SHOP_STACK__ = stack

  if (process.env.SIFALO_E2E === "1") {
    await enableSifaloForBuyers(stack)
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

/**
 * A payment provider that is LOADED is not yet one a buyer can CHOOSE.
 *
 * Medusa links providers to regions, and /store/payment-providers returns only
 * what that region has enabled. In production this is an admin action, and
 * deliberately so: installing a payment method and switching it on for a country
 * are different decisions, and the second one should be somebody's choice.
 *
 * This goes through POST /admin/regions/:id — the same call the dashboard makes
 * — rather than writing the link table directly. An earlier version did the
 * INSERT, which worked and proved the wrong thing: a shortcut no operator will
 * ever take. The switch someone flips at go-live is now the switch this test
 * exercises, so if that route stops working, this finds out.
 */
async function enableSifaloForBuyers(stack: Stack) {
  const api = stack.medusa.url

  const loaded = execFileSync(
    "psql",
    [stack.db.url, "-tAF|", "-c", "select id from payment_provider order by id"],
    { encoding: "utf8" }
  ).trim()
  console.log(`[shop] payment providers loaded: ${loaded.split("\n").join(", ")}`)
  if (!loaded.includes("pp_sifalo_sifalo")) {
    throw new Error(
      `the Sifalo provider did not load — payment_provider holds only: ${loaded}. ` +
        `A module that failed to register must fail HERE, not surface three steps later as a missing payment method.`
    )
  }

  const { E2E_ADMIN } = await import("../seed")
  const auth = await fetch(`${api}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_ADMIN.email, password: E2E_ADMIN.password }),
  })
  if (!auth.ok) {
    throw new Error(`could not authenticate as admin to enable the payment rail: ${auth.status}`)
  }
  const { token } = (await auth.json()) as { token: string }
  const admin = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const listed = await fetch(`${api}/admin/regions?fields=id,name,*payment_providers`, { headers: admin })
  const { regions } = (await listed.json()) as {
    regions: { id: string; name: string; payment_providers?: { id: string }[] }[]
  }

  for (const region of regions ?? []) {
    const already = (region.payment_providers ?? []).map((p) => p.id)
    const wanted = Array.from(new Set([...already, "pp_sifalo_sifalo"]))
    const res = await fetch(`${api}/admin/regions/${region.id}`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ payment_providers: wanted }),
    })
    if (!res.ok) {
      throw new Error(
        `the admin route refused to enable Sifalo on region ${region.name} (${res.status}: ${await res.text()}). ` +
          `That is the exact call someone makes at go-live, so it failing here IS the finding.`
      )
    }
  }

  // AND VERIFY THROUGH THE BUYER'S OWN ENDPOINT. Writing the link and assuming
  // the shop offers it is the same mistake as assuming a patch reached the
  // running code. Ask the store API what a customer would actually be shown.
  const key = readPublishableKey(stack.db.url)
  const offered = await fetch(`${api}/store/payment-providers?region_id=${regions[0].id}`, {
    headers: { "x-publishable-api-key": key },
  })
  const { payment_providers: shown } = (await offered.json()) as { payment_providers: { id: string }[] }
  const ids = (shown ?? []).map((p) => p.id)
  console.log(`[shop] the store now offers: ${ids.join(", ")}`)
  if (!ids.includes("pp_sifalo_sifalo")) {
    throw new Error(
      `Sifalo was enabled on every region and the store STILL does not offer it — it shows ${
        ids.join(", ") || "nothing"
      }. Fail loudly here rather than later as "the buyer was not offered Sifalo".`
    )
  }
}
