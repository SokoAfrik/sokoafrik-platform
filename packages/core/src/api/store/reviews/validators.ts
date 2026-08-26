import { z } from "zod"

import { createFindParams } from "@medusajs/medusa/api/utils/validators"

export type StoreGetReviewsParamsType = z.infer<typeof StoreGetReviewsParams>
export const StoreGetReviewsParams = createFindParams({
  offset: 0,
  limit: 50,
})

/**
 * SokoAfrik: at most four photos per review, and each must be a file we are
 * hosting. Accepting an arbitrary URL would let a review embed a link to anything
 * on the internet, which is a moderation problem and an SSRF one.
 */
export const ReviewImage = z.object({
  url: z.string().url(),
  file_id: z.string().nullish(),
})

export type StoreCreateReviewType = z.infer<typeof StoreCreateReview>
export const StoreCreateReview = z.object({
  order_id: z.string(),
  reference: z.enum(["seller", "product", "driver"]),
  reference_id: z.string(),
  rating: z.number().int().min(1).max(5),
  customer_note: z.string().max(300).nullish(),
  images: z.array(ReviewImage).max(4).nullish(),
})

export type StoreUpdateReviewType = z.infer<typeof StoreUpdateReview>
export const StoreUpdateReview = z.object({
  rating: z.number().int().min(1).max(5),
  customer_note: z.string().max(300).nullish(),
  images: z.array(ReviewImage).max(4).nullish(),
})
