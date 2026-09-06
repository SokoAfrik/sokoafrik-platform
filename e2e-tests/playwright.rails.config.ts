import { defineConfig } from "@playwright/test"

// The rails suite talks to a stub gateway on localhost and needs NO stack — no
// database, no storefront, no browser. Keeping it out of the shop config means
// a payment-rail proof costs seconds rather than two minutes of stack boot.
export default defineConfig({
  testDir: "./rails",
  timeout: 30_000,
  reporter: "line",
  use: {},
})
