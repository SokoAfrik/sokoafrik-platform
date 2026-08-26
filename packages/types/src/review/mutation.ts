import { ReviewImageDTO, ReviewReference, ReviewStatus } from "./common"

export interface CreateReviewDTO {
  order_id: string
  reference: ReviewReference
  reference_id: string
  rating: number
  customer_note?: string | null
  customer_id: string
  /** SokoAfrik: buyer photos, capped in the validator. */
  images?: ReviewImageDTO[] | null
}

export interface UpdateReviewDTO {
  id: string
  rating?: number
  customer_note?: string | null
  images?: ReviewImageDTO[] | null
  seller_note?: string | null
  status?: ReviewStatus
}

export interface RespondReviewDTO {
  id: string
  seller_note: string
}
