import {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { defineMiddlewares } from "@medusajs/medusa"

type ProductAttributeValue = {
  attribute?: { id?: string } | null
}

type Category = { id?: string | null }

type RequiredAttribute = {
  id: string
  name: string
  categories?: Category | Category[] | null
}

async function requireCategoryAttributesBeforePublish(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "categories.id",
      "product_attribute_values.attribute.id",
    ],
    filters: { id: req.params.id },
  })
  const product = data[0] as {
    categories?: Category[]
    product_attribute_values?: ProductAttributeValue[]
  } | undefined

  if (!product) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product ${req.params.id} was not found`,
    )
  }

  const supplied = new Set(
    (product.product_attribute_values ?? [])
      .map((value) => value.attribute?.id)
      .filter((id): id is string => Boolean(id)),
  )
  const categoryIds = new Set(
    (product.categories ?? [])
      .map((category) => category.id)
      .filter((id): id is string => Boolean(id)),
  )
  const { data: requiredAttributes } = await query.graph({
    entity: "product_attribute",
    fields: ["id", "name", "categories.id"],
    filters: { is_required: true, is_active: true, product_id: null },
  })
  const missing = (requiredAttributes as RequiredAttribute[])
    .filter((attribute) => {
      const categories = Array.isArray(attribute.categories)
        ? attribute.categories
        : attribute.categories
          ? [attribute.categories]
          : []
      return categories.some((category) =>
        category.id ? categoryIds.has(category.id) : false,
      )
    })
    .filter((attribute) => !supplied.has(attribute.id))
    .map((attribute) => attribute.name)
    .sort()

  if (missing.length > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Missing required category attributes: ${missing.join(", ")}`,
    )
  }

  return next()
}

export default defineMiddlewares({
  routes: [
    {
      method: ["POST"],
      matcher: "/admin/products/:id/confirm",
      middlewares: [requireCategoryAttributesBeforePublish],
    },
  ],
})
