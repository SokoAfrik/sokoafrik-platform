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

  const { data: orderGroups } = await query.graph({
    entity: "order_group",
    fields: ["id"],
    filters: { cart_id: cartId },
  })
  if (orderGroups.length !== 1) {
    throw new Error(
      `Captured payment ${event.data.id} resolved to ${orderGroups.length} order groups`
    )
  }

  await writeCapturedOrderToLedger(container, String(orderGroups[0].id))
}

export const config: SubscriberConfig = {
  event: PaymentEvents.CAPTURED,
  context: {
    subscriberId: "payment-captured-ledger-handler",
  },
}
