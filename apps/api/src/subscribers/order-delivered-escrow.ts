import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, FulfillmentWorkflowEvents } from "@medusajs/framework/utils"

import { scheduleEscrowRelease } from "../lib/schedule-escrow-release"

type DeliveryCreated = { id: string }

export default async function orderDeliveredEscrowHandler({
  event,
  container,
}: SubscriberArgs<DeliveryCreated>) {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const delivered = await db("order_fulfillment as link")
    .join("order as orders", "orders.id", "link.order_id")
    .join("fulfillment as fulfillments", "fulfillments.id", "link.fulfillment_id")
    .select("orders.display_id", "fulfillments.delivered_at")
    .where("link.fulfillment_id", event.data.id)
    .whereNull("link.deleted_at")
    .whereNull("orders.deleted_at")

  if (delivered.length !== 1 || !delivered[0].delivered_at) {
    throw new Error(
      `Delivered fulfillment ${event.data.id} resolved to ${delivered.length} delivered orders, expected exactly 1`
    )
  }

  await scheduleEscrowRelease(db, {
    subOrderId: String(delivered[0].display_id),
    deliveredAt: new Date(delivered[0].delivered_at),
  })
}

export const config: SubscriberConfig = {
  event: FulfillmentWorkflowEvents.DELIVERY_CREATED,
  context: {
    subscriberId: "order-delivered-escrow-handler",
  },
}
