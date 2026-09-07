import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type CapturedOrder = {
  id: string
  total: number | string
  currency_code: string
  cart?: {
    payment_collection?: {
      captured_amount?: number | string | null
    } | null
  } | null
}

const asMinorUnits = (value: number | string, label: string): bigint => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} is not a safe integer minor-unit amount`)
  }
  const minor = BigInt(value)
  if (minor <= 0n) {
    throw new Error(`${label} must be positive`)
  }
  return minor
}

const accountId = async (
  tx: any,
  kind: "platform_float" | "vendor_held",
  ownerType: "platform" | "vendor",
  currency: string
): Promise<string> => {
  const existing = await tx("ledger_accounts")
    .select("id")
    .where({ kind, owner_type: ownerType, currency })
    .whereNull("owner_id")
    .first()
  if (existing) return String(existing.id)

  const [created] = await tx("ledger_accounts")
    .insert({ kind, owner_type: ownerType, owner_id: null, currency })
    .returning("id")
  return String(created.id)
}

export const writeCapturedOrderToLedger = async (
  container: MedusaContainer,
  orderGroupId: string
): Promise<void> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_group",
    fields: [
      "id",
      "orders.id",
      "orders.total",
      "orders.currency_code",
      "orders.cart.payment_collection.captured_amount",
    ],
    filters: { id: orderGroupId },
  })
  const orders = (data[0]?.orders ?? []) as CapturedOrder[]
  if (!orders.length) {
    throw new Error(`Order group ${orderGroupId} has no orders to journal`)
  }

  const currencies = new Set(orders.map((order) => order.currency_code.toUpperCase()))
  if (currencies.size !== 1) {
    throw new Error(`Order group ${orderGroupId} spans multiple currencies`)
  }
  const currency = [...currencies][0]
  const total = orders.reduce(
    (sum, order) => sum + asMinorUnits(order.total, `order ${order.id} total`),
    0n
  )
  const captured = asMinorUnits(
    orders[0].cart?.payment_collection?.captured_amount ?? 0,
    `order group ${orderGroupId} captured amount`
  )
  if (captured !== total) {
    throw new Error(
      `Order group ${orderGroupId} captured ${captured}, expected ${total}`
    )
  }

  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await db.transaction(async (tx: any) => {
    await tx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [
      `soko-checkout-ledger:${orderGroupId}`,
    ])
    const existing = await tx("ledger_entries")
      .select("id")
      .where({ reason: "capture" })
      .whereRaw("meta->>'order_group_id' = ?", [orderGroupId])
      .first()
    if (existing) return

    const platformFloatId = await accountId(
      tx,
      "platform_float",
      "platform",
      currency
    )
    const vendorHeldId = await accountId(tx, "vendor_held", "vendor", currency)
    const transferResult = await tx.raw("SELECT gen_random_uuid() AS id")
    const transferId = transferResult.rows[0].id
    const meta = {
      order_group_id: orderGroupId,
      order_ids: orders.map((order) => order.id),
    }

    await tx("ledger_transfers").insert({ transfer_id: transferId })
    await tx("ledger_entries").insert([
      {
        transfer_id: transferId,
        account_id: platformFloatId,
        amount_minor: total.toString(),
        currency,
        reason: "capture",
        meta,
      },
      {
        transfer_id: transferId,
        account_id: vendorHeldId,
        amount_minor: (-total).toString(),
        currency,
        reason: "capture",
        meta,
      },
    ])
  })
}
