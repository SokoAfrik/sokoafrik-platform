import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, PaymentEvents } from "@medusajs/framework/utils"
import { writeCapturedOrderToLedger } from "../workflows/hooks/write-capture-ledger"

type PaymentCaptured = { id: string }

export default async function paymentCapturedLedgerHandler({
  event,
  container,
}: SubscriberArgs<PaymentCaptured>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: payments } = await query.graph({
    entity: "payment",
    fields: ["payment_collection.cart.id"],
    filters: { id: event.data.id },
  })
  const cartId = (payments[0] as {
    payment_collection?: { cart?: { id?: string } | null } | null
  } | undefined)?.payment_collection?.cart?.id
  if (!cartId) {
    throw new Error(`Captured payment ${event.data.id} has no cart`)
  }

  // WHY THIS IS QUERIED FROM THE CART AND NOT FILTERED BY cart_id.
  //
  // The previous version did query.graph({ entity: "order_group",
  // filters: { cart_id: cartId } }). That filter is SILENTLY IGNORED — proven on
  // the live system 2026-09-07 by filtering on a cart id that does not exist and
  // getting every order group back:
  //
  //     order groups in the database        : 3
  //     filtered by a REAL cart_id          : 3   (should be 1)
  //     filtered by a BOGUS cart_id         : 3   (should be 0)
  //     filtered by id                      : 1   (so filters do work — just not this field)
  //
  // With one order in the database that code is indistinguishable from correct.
  // It broke on the third real order and would have gone to production looking
  // fine. Filters work on `id`, so the cart is fetched by id and the order group
  // is read off it.
  // WHY THIS IS A SQL QUERY AND NOT query.graph.
  //
  // Two attempts failed on the live system on 2026-09-07, and both failed QUIETLY:
  //
  //   filters: { cart_id }        the filter is SILENTLY IGNORED. Proven by asking
  //                               for a cart id that does not exist and getting every
  //                               order group back:
  //                                 all order groups        : 3
  //                                 filtered by a real id   : 3   (should be 1)
  //                                 filtered by a bogus id  : 3   (should be 0)
  //                                 filtered by `id`        : 1   (filters DO work,
  //                                                                just not this field)
  //   cart -> order_group         that relation is not traversable in this direction;
  //                               every cart reports "no order group".
  //
  // With a single order in the database the first version was indistinguishable from
  // correct. It broke on the third real order. order_group.cart_id is a plain indexed
  // column, so it is read as one — from the same connection the ledger write uses, in
  // the same database, with no query layer in between to ignore anything.
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const found = await db("order_group")
    .select("id", "cart_id")
    .where({ cart_id: cartId })
    .whereNull("deleted_at")

  if (found.length !== 1) {
    throw new Error(
      `Captured payment ${event.data.id}: cart ${cartId} resolved to ${found.length} order groups, expected exactly 1`
    )
  }
  const group = found[0] as { id: string; cart_id: string }

  // The bug above was a filter that quietly did nothing, so what came back is checked
  // against what was asked for rather than trusted.
  if (group.cart_id !== cartId) {
    throw new Error(
      `Captured payment ${event.data.id}: asked for cart ${cartId}, got a group for ${group.cart_id} — ` +
      `refusing to journal somebody else's order`
    )
  }

  await writeCapturedOrderToLedger(container, String(group.id))
}

export const config: SubscriberConfig = {
  event: PaymentEvents.CAPTURED,
  context: {
    subscriberId: "payment-captured-ledger-handler",
  },
}
