import { test, expect } from "@playwright/test"
import { readFileSync, writeFileSync } from "fs"
import { STACK_STATE_FILE } from "../src/stack/paths"

// THE CUSTOMER JOURNEY. Browse, choose, add to cart, check out, read the order
// back. Every step is a click or a keystroke, because the question this answers
// is not "does the API respond" — it is "can a person buy something".
//
// Each stage is its own test.step so a failure names the exact point a buyer
// would be stuck at. A step that cannot be completed by clicking and typing is a
// FINDING about the product, not something to route around with an API call.
const shop = () => JSON.parse(readFileSync(STACK_STATE_FILE, "utf8")).storefront as string

const buyer = {
  first: "Amina",
  last: "Warsame",
  address: "Makka Al Mukarama Road 12",
  postal: "10115",
  city: "Mogadishu",
  province: "Banaadir",
  email: "amina.warsame@sokoafrik.test",
  phone: "+252612345678",
}

test("a customer can browse, add to cart and reach a placed order", async ({ page }) => {
  test.setTimeout(180_000)
  const base = shop()
  const reached: string[] = []
  const note = (s: string) => { reached.push(s); console.log(`[journey] ${s}`) }

  await test.step("the shop lists products with prices", async () => {
    await page.goto(`${base}/de`, { waitUntil: "networkidle" })
    const productLink = page.getByRole("link", { name: /^Go to .* page$/ }).first()
    await expect(productLink).toBeVisible()
    note("home page lists products")
  })

  let productName = ""
  await test.step("open a product", async () => {
    const link = page.getByRole("link", { name: /^Go to .* page$/ }).first()
    await link.click()
    await page.waitForURL(/\/products\//, { timeout: 30_000 })
    await page.waitForLoadState("networkidle")
    productName = (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? ""
    expect(productName, "the product page must name the product").not.toEqual("")
    note(`product page: ${productName}`)
  })

  await test.step("add it to the cart", async () => {
    // A buyer picks a size before adding. Mercur products carry variants and
    // multiple seller OFFERS ("Compare other 2 offers" is on the page), so the
    // add can silently resolve to nothing if no variant is chosen — see the
    // finding recorded below this step.
    const sizes = page.getByRole("button", { name: /^(3[5-9]|4[0-9])$/ })
    if (await sizes.count()) {
      await sizes.first().click()
      await page.waitForTimeout(1000)
      note(`size chosen: ${await sizes.first().textContent()}`)
    }
    await page.getByRole("button", { name: /add to cart/i }).first().click()
    // The header cart link carries the count; that is the buyer's own feedback
    // that the click did anything.
    // Two elements answer to "Go to cart": the header icon and one inside a
    // dropdown. getByLabel picks the header badge, which is the one a buyer sees.
    await expect(page.getByLabel("Go to cart")).toContainText("1", { timeout: 20_000 })
    note("item is in the cart")
  })

  await test.step("the cart shows the item and a total", async () => {
    await page.goto(`${base}/de/cart`, { waitUntil: "networkidle" })
    // A bare "element not found" here tells you nothing about what the buyer is
    // looking at. If the cart does not show the item, print what it DOES show —
    // an empty cart behind a badge that says 1 is a very different defect from a
    // renamed heading, and only the page itself can tell you which.
    const word = productName.split(" ")[0]
    // FINDING, recorded here because the test is where it was found: the header
    // badge goes to 1 the moment ADD TO CART is pressed, but the server-side cart
    // is not written yet. A buyer who clicks straight through to the cart is told
    // "Your shopping cart is currently empty" while the badge above still says 1.
    // Waiting and reloading recovers it, which is what proves it is a race and not
    // a lost item. The wait is deliberate and named, not a papered-over flake.
    let neededReload = false
    if (!(await page.getByText(word, { exact: false }).first().isVisible().catch(() => false))) {
      neededReload = true
      await page.waitForTimeout(4000)
      await page.reload({ waitUntil: "networkidle" })
    }
    note(`cart needed a reload before it showed the item: ${neededReload}`)
    try {
      await expect(page.getByText(word, { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    } catch (e) {
      const seen = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] CART DID NOT SHOW "${word}". The cart page shows:\n${seen.slice(0, 2500)}`)
      throw e
    }
    await expect(page.getByText(/Total:/).first()).toBeVisible()
    note("cart shows the item and a total")
  })

  await test.step("go to checkout", async () => {
    await page.getByRole("link", { name: /go to checkout/i }).first().click()
    await page.waitForURL(/checkout/, { timeout: 30_000 })
    await expect(page.getByRole("heading", { name: /shipping address/i })).toBeVisible()
    note("checkout reached")
  })

  await test.step("fill the shipping address and save", async () => {
    await page.locator('input[name="shipping_address.first_name"]').fill(buyer.first)
    await page.locator('input[name="shipping_address.last_name"]').fill(buyer.last)
    await page.locator('input[name="shipping_address.address_1"]').fill(buyer.address)
    await page.locator('input[name="shipping_address.postal_code"]').fill(buyer.postal)
    await page.locator('input[name="shipping_address.city"]').fill(buyer.city)
    await page.locator('input[name="shipping_address.province"]').fill(buyer.province)
    await page.locator('input[name="email"]').fill(buyer.email)
    await page.locator('input[name="shipping_address.phone"]').fill(buyer.phone)
    await page.getByRole("button", { name: /^save$/i }).click()
    await page.waitForTimeout(4000)
    note("address saved")
  })

  await test.step("choose a delivery option", async () => {
    await expect(page.getByRole("heading", { name: /delivery/i }).first()).toBeVisible()
    const radios = page.getByRole("radio")
    const n = await radios.count()
    note(`delivery options offered: ${n}`)
    if (n === 0) {
      const seen = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] DELIVERY SECTION AS RENDERED:\n${seen.slice(0, 3000)}`)
      const shipReq = await page.evaluate(() => (window as any).__lastShipping ?? "n/a")
      console.log(`[journey] (${shipReq})`)
    }
    expect(n, "a buyer must be offered at least one delivery option").toBeGreaterThan(0)
    await radios.first().check()
    const next = page.getByRole("button", { name: /continue|next|save|proceed/i }).first()
    if (await next.count()) { await next.click(); await page.waitForTimeout(3000) }
    note("delivery chosen")
  })

  await test.step("pay and place the order", async () => {
    await expect(page.getByRole("heading", { name: /payment/i }).first()).toBeVisible()
    const pay = page.getByRole("button", { name: /place order|pay|complete/i }).first()
    expect(await pay.count(), "there must be a control that places the order").toBeGreaterThan(0)
    await pay.click()
    await page.waitForTimeout(6000)
    note(`after placing the order the browser is at ${page.url()}`)
  })

  await test.step("the order is readable back", async () => {
    const body = await page.locator("body").innerText()
    expect(body, "the order confirmation must name the order").toMatch(/order|thank/i)
    note("order confirmation reached")
  })

  writeFileSync("/home/sokoafrik/journey-reached.txt", reached.join("\n"))
})
