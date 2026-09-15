import { SellerDTO } from "@mercurjs/types"
import LocalizedClientLink from "../LocalizedLink/LocalizedLink"
import { SellerInfoHeader } from "../SellerInfoHeader/SellerInfoHeader"

export const SellerInfo = ({
  seller,
  header = false,
  showArrow = false,
  bottomBorder = false,
  showReviews = false,
  rating = 0,
  reviewCount = 0,
}: {
  seller: SellerDTO
  header?: boolean
  showArrow?: boolean
  bottomBorder?: boolean
  showReviews?: boolean
  rating?: number
  reviewCount?: number
}) => {
  const { logo, name } = seller

  const headerContent = (
    <SellerInfoHeader
      photo={logo ?? ""}
      name={name}
      showArrow={showArrow}
      bottomBorder={bottomBorder}
      showReviews={showReviews}
      rating={rating}
      reviewCount={reviewCount}
    />
  )

  return (
    <div className="flex flex-col w-full">
      {showArrow ? (
        <LocalizedClientLink
          href={`/sellers/${seller.handle}`}
          aria-label={`View ${name} seller`}
        >
          {headerContent}
        </LocalizedClientLink>
      ) : (
        headerContent
      )}
    </div>
  )
}
