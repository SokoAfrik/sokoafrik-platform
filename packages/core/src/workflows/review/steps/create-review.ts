import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { Link } from "@medusajs/framework/modules-sdk"
import { CreateReviewDTO } from "@mercurjs/types"

import ReviewModuleService from "../../../modules/review/service"
import { MercurModules } from "@mercurjs/types"

export const createReviewStep = createStep(
  "create-review",
  async (input: CreateReviewDTO, { container }) => {
    const service = container.resolve<ReviewModuleService>(MercurModules.REVIEW)
    const link = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const review = await service.createReviews({
      reference: input.reference,
      // SokoAfrik: stored as a column, not only implied by a module link. Drivers
      // have no module to link to, and it makes "every review of X" one query.
      reference_id: input.reference_id ?? null,
      rating: input.rating,
      customer_note: input.customer_note ?? null,
      // Medusa types a json() column as Record<string, unknown>; the column itself
      // holds any JSON. The array shape is the useful one at the API boundary, so
      // the cast lives here and nowhere else.
      images: (input.images ?? null) as unknown as Record<string, unknown> | null,
    })

    await link.create([
      {
        [Modules.CUSTOMER]: {
          customer_id: input.customer_id,
        },
        [MercurModules.REVIEW]: {
          review_id: review.id,
        },
      },
      {
        [Modules.ORDER]: {
          order_id: input.order_id,
        },
        [MercurModules.REVIEW]: {
          review_id: review.id,
        },
      },
    ])

    return new StepResponse(review, review.id)
  },
  async (reviewId: string | undefined, { container }) => {
    if (!reviewId) {
      return
    }
    const service = container.resolve<ReviewModuleService>(MercurModules.REVIEW)
    await service.deleteReviews(reviewId)
  }
)
