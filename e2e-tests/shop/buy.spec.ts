import { test, expect } from "@playwright/test"
import { readFileSync, writeFileSync } from "fs"
import { execFileSync } from "child_process"
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

test("browse_cart_checkout_order_status_e2e_test — a customer can browse, add to cart, pay, and read the order back", async ({ page }) => {
  test.setTimeout(360_000)
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
    // NOT a radio group. Mercur renders one dropdown per SELLER, opened by a
    // button reading "Choose delivery option". Counting radios here reported
    // "0 options offered" while the options were on the page the whole time —
    // a broken check reporting a defect that is not there. Drive the control a
    // buyer actually sees.
    const opener = page.getByRole("button", { name: /choose delivery option/i })
    const sellers = await opener.count()
    note(`delivery choosers on the page (one per seller): ${sellers}`)
    if (sellers === 0) {
      const seen = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] DELIVERY SECTION AS RENDERED:\n${seen.slice(0, 3000)}`)
    }
    expect(sellers, "a buyer must be offered a way to choose delivery").toBeGreaterThan(0)

    for (let i = 0; i < sellers; i++) {
      await opener.nth(i).click()
      await page.waitForTimeout(1200)
      const opened = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] DROPDOWN ${i} OPENED:\n${opened.slice(0, 3500)}`)
      // Whatever the widget is built from, a buyer clicks the first row in it.
      const byOption = page.getByRole("option")
      const byRadio = page.getByRole("radio")
      const byPrice = page.getByText(/Shipping|Express|Standard/i)
      if (await byOption.count()) {
        note(`dropdown ${i}: ${await byOption.count()} role=option rows`)
        await byOption.first().click()
      } else if (await byRadio.count()) {
        note(`dropdown ${i}: ${await byRadio.count()} role=radio rows`)
        await byRadio.first().check()
      } else if (await byPrice.count()) {
        note(`dropdown ${i}: falling back to a named shipping row`)
        await byPrice.first().click()
      } else {
        throw new Error("the delivery dropdown opened but offered nothing to pick")
      }
      await page.waitForTimeout(2500)
    }
    note("delivery chosen")

    const next = page.getByRole("button", { name: /continue to payment/i }).first()
    // The button is disabled until every seller has a method. If it stays
    // disabled, the pick did not register — say so instead of timing out blind.
    try {
      await expect(next).toBeEnabled({ timeout: 25_000 })
    } catch (e) {
      const seen = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] CONTINUE STAYED DISABLED AFTER PICKING. Page:\n${seen.slice(0, 3000)}`)
      throw e
    }
    await next.click()
    await page.waitForTimeout(4000)
    note(`after continue the browser is at ${page.url()}`)
  })

  await test.step("pay and place the order", async () => {
    await expect(page.getByRole("heading", { name: /payment/i }).first()).toBeVisible({ timeout: 20_000 })
    const seen = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
    console.log(`[journey] PAYMENT SECTION AS RENDERED:\n${seen.slice(0, 4000)}`)

    // Pick a payment method if the step offers a choice.
    const methods = page.getByRole("radio")
    if (await methods.count()) {
      note(`payment methods offered: ${await methods.count()}`)
      await methods.first().check()
      await page.waitForTimeout(2000)
    }
    const contPay = page.getByRole("button", { name: /continue to review|continue|next/i }).first()
    if (await contPay.count() && await contPay.isEnabled().catch(() => false)) {
      await contPay.click()
      await page.waitForTimeout(4000)
      const rev = await page.locator("main").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] REVIEW SECTION AS RENDERED:\n${rev.slice(0, 3000)}`)
    }

    const pay = page.getByRole("button", { name: /place order|pay now|complete order/i }).first()
    const has = await pay.count()
    expect(has, "there must be a control that places the order").toBeGreaterThan(0)
    await expect(pay).toBeEnabled({ timeout: 20_000 })
    await pay.click()
    await page.waitForTimeout(10_000)
    note(`after placing the order the browser is at ${page.url()}`)
  })

  await test.step("the order is readable back", async () => {
    // A URL is not a purchase. The order has to exist in the system of record
    // carrying the buyer, the item and the delivery method they chose, and it
    // has to be readable back to the person who placed it. Both halves assert.
    // Two legitimate destinations: a signed-in customer gets the order-group
    // page; a guest gets the public confirmation. Both are a placed order.
    const ORDER_URL = new RegExp("(/user/orders/(og|order)_|/order/order_[A-Z0-9]+/confirmed)")
    await expect(page).toHaveURL(ORDER_URL, { timeout: 30_000 })
    const orderId = (page.url().match(/(og|order)_[A-Z0-9]+/) ?? [""])[0]
    expect(orderId, "the browser must land on a real order id").not.toEqual("")
    note(`order group id: ${orderId}`)

    // --- the system of record ---
    const state = JSON.parse(readFileSync(STACK_STATE_FILE, "utf8"))
    const dbUrl = state.databaseUrl ?? process.env.DATABASE_URL ?? ""
    if (!dbUrl) throw new Error("cannot verify the order: the stack did not record a database url")
    // A query that errors must SAY so, not read as an empty result — an empty
    // string here would let "no order" pass for "nothing to report".
    const q = (label: string, sql: string) => {
      let out: string
      try {
        out = execFileSync("psql", [dbUrl, "-tAF|", "-c", sql], { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim()
      } catch (e: any) {
        out = `QUERY FAILED: ${String(e.stderr ?? e.message).trim()}`
      }
      console.log(`[journey] ${label}:`)
      console.log(out)
      return out
    }
    const orders = q("ORDERS", `select id, status, currency_code, email from "order" order by created_at desc limit 3`)
    // order_line_item carries the title and price; the quantity lives on the
    // order_item join row, which is why a flat select on either one is wrong.
    const items = q("ORDER ITEMS", `select li.title, oi.quantity, li.unit_price from order_item oi join order_line_item li on li.id = oi.item_id order by oi.created_at desc limit 5`)
    const ship = q("SHIPPING METHODS", `select name, amount from order_shipping_method order by created_at desc limit 5`)
    q("PAYMENT COLLECTIONS", `select id, amount, currency_code, status from payment_collection order by created_at desc limit 3`)
    q("PAYMENTS", `select provider_id, amount, currency_code, captured_at from payment order by created_at desc limit 3`)

    expect(orders, "an order must exist in the database after checkout").not.toEqual("")
    expect(orders, "the order must carry the buyer's email").toContain(buyer.email)
    expect(items, "the order must carry the item that was bought").toContain(productName.split(" ")[0])
    expect(ship, "the order must carry the delivery method the buyer chose").not.toEqual("")

    // --- readable back to the buyer ---
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(5000)
    const body = await page.locator("body").innerText()
    console.log(`[journey] ORDER PAGE URL ${page.url()} body length ${body.length}`)
    console.log("[journey] ORDER PAGE TEXT >>>")
    console.log(body.slice(0, 2000))
    console.log("[journey] <<< END")
    if (body.trim().length === 0) {
      const snap = await page.locator("body").ariaSnapshot().catch(() => "(no snapshot)")
      console.log(`[journey] ORDER PAGE RENDERED NOTHING. Tree:\n${snap.slice(0, 1500)}`)
      const html = await page.content()
      console.log(`[journey] ORDER PAGE HTML HEAD:\n${html.slice(0, 1500)}`)
    }
    expect(body.trim().length, "the page after checkout must show the buyer something").toBeGreaterThan(0)
    expect(body, "a buyer whose payment was authorised must never be shown a login form").not.toMatch(/forgot your password|don't have an account/i)
    expect(body, "the page must tell the buyer the order was placed").toMatch(/thank you|placed successfully|order confirmed/i)
    expect(body, "the confirmation must name the buyer it was sent to").toContain(buyer.email)
    // A receipt has to carry something the buyer can quote back to us. Thank-you
    // alone is not an order status.
    expect(body, "the confirmation must show an order number").toMatch(/order number/i)
    // The item heading is CSS-uppercased, so innerText returns it in caps.
    // Comparing case-sensitively failed on a receipt that was correct.
    expect(body.toLowerCase(), "the confirmation must name what was bought").toContain(
      productName.split(" ")[0].toLowerCase()
    )
    expect(body, "the confirmation must show the order status").toMatch(/order status/i)
    const status = (await page.getByTestId("order-status").innerText().catch(() => "")).trim()
    note(`order status shown to the buyer: "${status}"`)
    expect(status, "the order status must have a value, not an empty label").not.toEqual("")
    expect(status.toLowerCase(), "an unknown status is not a status").not.toEqual("unknown")
    expect(body, "the confirmation must show a total").toMatch(/total/i)
    note(`order ${orderId} placed and readable back`)
    writeFileSync("/home/sokoafrik/journey-order-id.txt", orderId)
  })

  writeFileSync("/home/sokoafrik/journey-reached.txt", reached.join("\n"))
})
