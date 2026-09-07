import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type CapturedOrder = {
  id: string
  total: number | string
  currency_code: string
  cart?: { payment_collection?: { captured_amount?: number | string | null } | null } | null
}

const asMinorUnits = (value: number | string, label: string): bigint => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} is not a safe integer minor-unit amount`)
  }
  const minor = BigInt(value)
  if (minor <= 0n) throw new Error(`${label} must be positive`)
  return minor
}

const platformAccountId = async (tx: any, currency: string): Promise<string> => {
  const existing = await tx("ledger_accounts")
    .select("id").where({ kind: "platform_float", owner_type: "platform", currency })
    .whereNull("owner_id").first()
  if (existing) return String(existing.id)
  const [created] = await tx("ledger_accounts")
    .insert({ kind: "platform_float", owner_type: "platform", owner_id: null, currency })
    .returning("id")
  return String(created.id)
}

// One held account PER VENDOR. Previously every capture credited a single
// vendor_held account with owner_id NULL, so five vendors' money sat in one
// undifferentiated pile: the ORDER was split per seller and the LEDGER was not.
// Nothing could then say what any one vendor was owed, which means nothing could
// pay them.
const vendorHeldAccountId = async (tx: any, vendorId: string, currency: string): Promise<string> => {
  const existing = await tx("ledger_accounts")
    .select("id").where({ kind: "vendor_held", owner_type: "vendor", owner_id: vendorId, currency })
    .first()
  if (existing) return String(existing.id)
  const [created] = await tx("ledger_accounts")
    .insert({ kind: "vendor_held", owner_type: "vendor", owner_id: vendorId, currency })
    .returning("id")
  return String(created.id)
}

// The marketplace calls a vendor 'sel_01M1...'; the money layer's owner_id is a
// BIGINT. vendor_identity is the seam. Allocated on first capture, never reused.
const vendorIdFor = async (tx: any, sellerId: string): Promise<string> => {
  const existing = await tx("vendor_identity").select("vendor_id").where({ seller_id: sellerId }).first()
  if (existing) return String(existing.vendor_id)
  const [created] = await tx("vendor_identity").insert({ seller_id: sellerId }).returning("vendor_id")
  return String(created.vendor_id)
}

export const writeCapturedOrderToLedger = async (
  container: MedusaContainer,
  orderGroupId: string
): Promise<void> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_group",
    fields: ["id", "orders.id", "orders.total", "orders.currency_code",
             "orders.cart.payment_collection.captured_amount"],
    filters: { id: orderGroupId },
  })
  const orders = (data[0]?.orders ?? []) as CapturedOrder[]
  if (!orders.length) throw new Error(`Order group ${orderGroupId} has no orders to journal`)

  const currencies = new Set(orders.map((o) => o.currency_code.toUpperCase()))
  if (currencies.size !== 1) throw new Error(`Order group ${orderGroupId} spans multiple currencies`)
  const currency = [...currencies][0]

  const perOrder = orders.map((o) => ({ id: o.id, minor: asMinorUnits(o.total, `order ${o.id} total`) }))
  const total = perOrder.reduce((sum, o) => sum + o.minor, 0n)
  const captured = asMinorUnits(
    orders[0].cart?.payment_collection?.captured_amount ?? 0,
    `order group ${orderGroupId} captured amount`
  )
  if (captured !== total) {
    throw new Error(`Order group ${orderGroupId} captured ${captured}, expected ${total}`)
  }

  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await db.transaction(async (tx: any) => {
    await tx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`soko-checkout-ledger:${orderGroupId}`])
    const existing = await tx("ledger_entries").select("id")
      .where({ reason: "capture" })
      .whereRaw("meta->>'order_group_id' = ?", [orderGroupId]).first()
    if (existing) return

    // Which seller owns which order. Read as SQL: the link is a plain table, and
    // query.graph has already been caught silently ignoring a filter on this data
    // (see payment-captured-ledger.ts, 2026-09-07).
    const links = await tx("order_order_seller_seller")
      .select("order_id", "seller_id")
      .whereIn("order_id", perOrder.map((o) => o.id))
      .whereNull("deleted_at")

    const sellerOf = new Map<string, string>(links.map((l: any) => [String(l.order_id), String(l.seller_id)]))
    const missing = perOrder.filter((o) => !sellerOf.has(o.id))
    if (missing.length) {
      // An order with no seller cannot be credited to anyone. Refusing beats
      // quietly dropping its money into an aggregate account nobody can be paid from.
      throw new Error(
        `Order group ${orderGroupId}: no seller for ${missing.map((m) => m.id).join(", ")} — refusing to journal`
      )
    }

    // Sum per vendor, because one vendor can hold more than one order in a group.
    const perVendor = new Map<string, bigint>()
    for (const o of perOrder) {
      const seller = sellerOf.get(o.id)!
      perVendor.set(seller, (perVendor.get(seller) ?? 0n) + o.minor)
    }

    const transferId = (await tx.raw("SELECT gen_random_uuid() AS id")).rows[0].id
    const meta = {
      order_group_id: orderGroupId,
      order_ids: perOrder.map((o) => o.id),
    }
    await tx("ledger_transfers").insert({ transfer_id: transferId })

    const legs: any[] = [{
      transfer_id: transferId,
      account_id: await platformAccountId(tx, currency),
      amount_minor: total.toString(),
      currency, reason: "capture", meta,
    }]

    for (const [sellerId, amount] of perVendor) {
      const vendorId = await vendorIdFor(tx, sellerId)
      legs.push({
        transfer_id: transferId,
        account_id: await vendorHeldAccountId(tx, vendorId, currency),
        amount_minor: (-amount).toString(),
        currency, reason: "capture",
        meta: { ...meta, seller_id: sellerId, vendor_id: vendorId },
      })
    }

    // The legs must sum to zero. The database enforces this at COMMIT anyway; the
    // check is here so a mistake is named where it was made rather than surfacing
    // as a constraint violation three frames away.
    const sum = legs.reduce((acc, l) => acc + BigInt(l.amount_minor), 0n)
    if (sum !== 0n) {
      throw new Error(`Order group ${orderGroupId}: capture legs sum to ${sum}, not zero`)
    }

    await tx("ledger_entries").insert(legs)
  })
}
