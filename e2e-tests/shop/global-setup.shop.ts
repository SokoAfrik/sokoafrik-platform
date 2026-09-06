import { writeFileSync } from "fs"
import { startStack, type Stack } from "../src/stack/stack"
import { STACK_STATE_FILE } from "../src/stack/paths"

// The customer suite. Same stack as the journeys, plus apps/storefront, and
// seeded with the demo catalog because a shop with nothing in it cannot be
// browsed — and because the storefront needs a publishable API key, which only
// the catalog seed creates.
declare global {
  var __SHOP_STACK__: Stack | undefined
}

export default async function globalSetup() {
  const stack = await startStack({
    seedExec: "./guides/guide-seed-exec.ts",
    withStorefront: true,
  })
  globalThis.__SHOP_STACK__ = stack
  writeFileSync(STACK_STATE_FILE, JSON.stringify(stack.urls, null, 2))
  console.log(
    `\n[shop] stack up:\n  medusa:     ${stack.urls.medusa}\n  storefront: ${stack.urls.storefront}\n`
  )
}
