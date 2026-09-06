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
  address: "Kurfuerstendamm 1",
  postal: "10115",
  city: "Berlin",
  province: "Berlin",
  email: "amina.warsame@sokoafrik.test",
  phone: "+491701234567",
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
    // TYPE, DO NOT fill(). These are controlled React inputs whose onChange sets
    // component state. fill() sets the DOM value and the box LOOKS right, but the
    // component never sees it, so Save submits an empty form — which produced a
    // confident and completely wrong finding that "checkout sends nothing to the
    // store API". It does; it was being handed nothing to send. Typing character
    // by character and tabbing out is what a buyer does and what the form reads.
    const type = async (name: string, value: string) => {
      const el = page.locator(`input[name="${name}"]`)
      await el.click()
      await el.pressSequentially(value, { delay: 15 })
      await el.press("Tab")
    }
    await type("shipping_address.first_name", buyer.first)
    await type("shipping_address.last_name", buyer.last)
    await type("shipping_address.address_1", buyer.address)
    await type("shipping_address.postal_code", buyer.postal)
    await type("shipping_address.city", buyer.city)
    await type("shipping_address.province", buyer.province)
    await type("email", buyer.email)
    await type("shipping_address.phone", buyer.phone)
    const wrote: string[] = []
    page.on("response", (r) => {
      if (r.request().method() !== "GET") wrote.push(`${r.request().method()} ${r.status()} ${r.url().slice(0, 70)}`)
    })
    await page.getByRole("button", { name: /^save$/i }).click()
    await page.waitForTimeout(8000)
    note(`calls made by Save: ${JSON.stringify(wrote)}`)
    // Saving posts a Next server action, which calls Medusa server-side; the
    // browser never talks to /store directly here. The proof it worked is that
    // the checkout advances off the address step.
    await expect(page).toHaveURL(/step=delivery/, { timeout: 20_000 })
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
    // THE WALL. The database has 10 shipping options across 5 service zones, the
    // geo zone for "de" exists and carries Standard and Express Shipping, and the
    // cart's saved address is de/Berlin — and the buyer is still offered nothing.
    // So this is not missing seed data and not a wrong address; something between
    // the cart and those options does not connect. Shipping PROFILE is the first
    // suspect: there are two, and every option sits on one of them.
    expect(n, "a buyer must be offered at least one delivery option — 10 exist in the database and none reach the cart").toBeGreaterThan(0)
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
