import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

export const config = defineWidgetConfig({
  zone: "product.detail.side.before",
})

type ProductDetail = {
  status?: string
  images?: unknown[]
  variants?: unknown[]
}

type Translate = (key: string) => string

export const ProductDiscoverability = ({
  data,
  translate,
}: {
  data?: ProductDetail
  translate: Translate
}) => {
  const reasons = [
    data?.status !== "published"
      ? translate("products.searchVisibility.reasons.notPublished")
      : null,
    !data?.images?.length
      ? translate("products.searchVisibility.reasons.noMedia")
      : null,
    !data?.variants?.length
      ? translate("products.searchVisibility.reasons.noVariants")
      : null,
  ].filter((reason): reason is string => reason !== null)

  return (
    <div data-testid="product-search-visibility">
      <Heading level="h2">
        {translate("products.searchVisibility.title")}
      </Heading>
      {reasons.length ? (
        <>
          <Text size="small" className="text-ui-fg-subtle">
            {translate("products.searchVisibility.hidden")}
          </Text>
          <ul className="mt-2 list-disc pl-5 text-ui-fg-subtle">
            {reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </>
      ) : (
        <Text size="small" className="text-ui-fg-subtle">
          {translate("products.searchVisibility.eligible")}
        </Text>
      )}
    </div>
  )
}

const ProductDetailInfo = ({ data }: { data?: ProductDetail }) => {
  const { t } = useTranslation()

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <ProductDiscoverability data={data} translate={t} />
      </div>
    </Container>
  )
}

export default ProductDetailInfo
