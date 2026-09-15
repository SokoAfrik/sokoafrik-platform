import { SellerInfo } from "@/components/molecules/SellerInfo/SellerInfo"
import { SellerDTO } from "@mercurjs/types"

type SellerWithReviews = SellerDTO & {
  reviews?: Array<{ rating: number; status: string }>
}

export const ProductDetailsSeller = ({ seller }: { seller?: SellerWithReviews }) => {
  if (!seller) return null

  const publishedReviews = seller.reviews?.filter(
    (review) => review.status === "published"
  ) ?? []
  const rating = publishedReviews.length
    ? publishedReviews.reduce((sum, review) => sum + review.rating, 0) /
      publishedReviews.length
    : 0

  return (
    <div className="border rounded-sm">
      <div>
          <div className="flex justify-between">
            <SellerInfo
              seller={seller}
              showArrow
              bottomBorder
              showReviews
              rating={rating}
              reviewCount={publishedReviews.length}
            />
          </div>
      </div>
    </div>
  )
}
