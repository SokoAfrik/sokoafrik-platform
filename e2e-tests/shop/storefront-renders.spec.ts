import { test, expect } from "@playwright/test"
import { readFileSync } from "fs"
import { STACK_STATE_FILE } from "../src/stack/paths"

// The first question, before any journey: does the shop render at all, with the
// seeded catalog behind it? Everything else (cart, checkout, order status) is
// built on top of this being true.
const storefrontUrl = () =>
  JSON.parse(readFileSync(STACK_STATE_FILE, "utf8")).storefront as string

test.describe("storefront", () => {
  test("the shop home page renders", async ({ page }) => {
    const res = await page.goto(storefrontUrl(), { waitUntil: "domcontentloaded" })
    expect(res?.status(), "the storefront must answer, not error").toBeLessThan(400)
    await expect(page.locator("body")).toBeVisible()
    // A shop that renders its shell but no products is not a shop. Recorded as a
    // separate expectation so the failure says which of the two happened.
    const html = await page.content()
    expect(html.length, "the page must have real content, not an error shell").toBeGreaterThan(1000)
  })
})
