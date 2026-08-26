import { Modules } from "@medusajs/framework/utils"
import {
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { CreateReviewDTO, MercurModules } from "@mercurjs/types"

import { createReviewStep, validateReviewStep } from "../steps"

export const createReviewWorkflow = createWorkflow(
  {
    name: "create-review",
  },
  function (input: CreateReviewDTO) {
    validateReviewStep(input)
    const review = createReviewStep(input)

    // SokoAfrik: three references now, not two. This used to be a ternary, which
    // would have quietly linked a DRIVER id into the seller table — a silent
    // corruption rather than an error. Drivers live in SokoAfrik's delivery layer
    // and have no Medusa module, so they link to nothing here; the review carries
    // `reference_id` instead, and the order link (created in the step) is what ties
    // the review to the delivery it came from.
    const link = transform({ input, review }, ({ input, review }) => {
      if (input.reference === "product") {
        return [
          {
            [Modules.PRODUCT]: { product_id: input.reference_id },
            [MercurModules.REVIEW]: { review_id: review.id },
          },
        ]
      }
      if (input.reference === "seller") {
        return [
          {
            [MercurModules.SELLER]: { seller_id: input.reference_id },
            [MercurModules.REVIEW]: { review_id: review.id },
          },
        ]
      }
      return []
    })

    createRemoteLinkStep(link)

    return new WorkflowResponse(review)
  }
)
