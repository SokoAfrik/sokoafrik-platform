import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep } from "@medusajs/framework/workflows-sdk"
import { Query } from "@medusajs/framework"
import { CreateReviewDTO } from "@mercurjs/types"

import orderReview from "../../../links/order-review"

/**
 * SokoAfrik changes to Mercur's review validation. Two of them:
 *
 *  1. YOU CAN ONLY REVIEW WHAT HAS ARRIVED.
 *     Upstream checks the order is yours and stops there — so a customer could rate
 *     a product the moment they paid, before anyone had packed it. On SokoAfrik the
 *     escrow releases when the customer gives the rider their code, which is the
 *     same moment they first hold the goods. That is when an opinion exists, so
 *     that is when a review is allowed.
 *
 *  2. THE DUPLICATE CHECK NOW COMPARES `reference_id` DIRECTLY.
 *     Upstream traversed the link and read `rev[rev.reference].id`, which only works
 *     for references that are Medusa modules. Drivers are not. Comparing the stored
 *     column is simpler, and it is the same check for all three kinds.
 */
export const validateReviewStep = createStep(
  "validate-review",
  async (reviewToCreate: CreateReviewDTO, { container }) => {
    const query = container.resolve<Query>(ContainerRegistrationKeys.QUERY)

    const {
      data: [order],
    } = await query.graph({
      entity: "order",
      fields: ["id", "fulfillments.delivered_at", "fulfillments.canceled_at"],
      filters: {
        id: reviewToCreate.order_id,
        customer_id: reviewToCreate.customer_id,
      },
    })

    // Not your order, or no such order. Same message either way — telling a stranger
    // which order ids exist is a small leak with no upside.
    if (!order) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Order not found!")
    }

    const delivered = (order.fulfillments ?? []).some(
      (f: { delivered_at?: Date | string | null; canceled_at?: Date | string | null }) =>
        !!f?.delivered_at && !f?.canceled_at
    )

    if (!delivered) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "You can review this once it has been delivered."
      )
    }

    // A driver review needs someone to point at, and there is no module link to
    // fall back on, so the id is required rather than optional.
    if (reviewToCreate.reference === "driver" && !reviewToCreate.reference_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A driver review needs a driver."
      )
    }

    const { data } = await query.graph({
      entity: orderReview.entryPoint,
      fields: ["review.reference", "review.reference_id"],
      filters: {
        order_id: reviewToCreate.order_id,
      },
    })

    const alreadyReviewed = data
      .map((relation) => relation.review)
      .some(
        (rev) =>
          rev?.reference === reviewToCreate.reference &&
          rev?.reference_id === reviewToCreate.reference_id
      )

    if (alreadyReviewed) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Review already exists"
      )
    }
  }
)
