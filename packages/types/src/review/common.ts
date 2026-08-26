import { DeleteResponse, PaginatedResponse } from "@medusajs/types"

// SokoAfrik: "driver" added. Riders carry other people's goods and are the half
// of the experience customers actually complain about.
export type ReviewReference = "product" | "seller" | "driver"

export type ReviewStatus = "pending" | "published" | "rejected"

/** SokoAfrik: one buyer photo. Stored as a file reference, never a raw URL. */
export interface ReviewImageDTO {
  url: string
  file_id?: string | null
}

export interface ReviewDTO {
  id: string
  display_id: number
  reference: ReviewReference
  /** SokoAfrik: stored, not only implied by a module link — drivers have no module. */
  reference_id: string | null
  images: ReviewImageDTO[] | null
  rating: number
  customer_note: string | null
  seller_note: string | null
  status: ReviewStatus
  created_at: Date | string
  updated_at: Date | string | null
  deleted_at?: Date | string | null
}

export interface AdminReviewResponse {
  review: ReviewDTO
}

export type AdminReviewListResponse = PaginatedResponse<{
  reviews: ReviewDTO[]
}>

export type AdminReviewDeleteResponse = DeleteResponse<"review">

export interface StoreReviewResponse {
  review: ReviewDTO
}

export type StoreReviewListResponse = PaginatedResponse<{
  reviews: ReviewDTO[]
}>

export type StoreReviewDeleteResponse = DeleteResponse<"review">

export interface VendorReviewResponse {
  review: ReviewDTO
}

export type VendorReviewListResponse = PaginatedResponse<{
  reviews: ReviewDTO[]
}>
