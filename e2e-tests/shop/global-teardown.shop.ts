import type { Stack } from "../src/stack/stack"

export default async function globalTeardown() {
  const stack = (globalThis as { __SHOP_STACK__?: Stack }).__SHOP_STACK__
  await stack?.shutdownAll()
}
