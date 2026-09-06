import { defineConfig, devices } from "@playwright/test"
import { readFileSync } from "fs"
import { STACK_STATE_FILE } from "./src/stack/paths"

// The CUSTOMER suite: a real browser walking the shop the way a buyer does.
// Separate from playwright.config.ts because it seeds a catalog and starts
// apps/storefront, which the dashboard journeys neither need nor should wait for.
export default defineConfig({
  testDir: "./shop",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  globalSetup: "./shop/global-setup.shop.ts",
  globalTeardown: "./shop/global-teardown.shop.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: (() => {
      try {
        return JSON.parse(readFileSync(STACK_STATE_FILE, "utf8")).storefront
      } catch {
        return undefined
      }
    })(),
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
