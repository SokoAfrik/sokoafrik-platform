import {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import { defineMiddlewares } from "@medusajs/medusa"
import { randomUUID } from "node:crypto"

import { STOREFRONT_IMPRESSION_MODULE } from "../modules/storefront-impression"
import type StorefrontImpressionModuleService from "../modules/storefront-impression/service"

const STOREFRONT_SEARCH_MODEL_VERSION = "medusa-products-v1"
const PASSWORD_RESPONSE_FIELDS = new Set([
  "password",
  "password_hash",
  "passwordHash",
])

type ProductAttributeValue = {
  attribute?: { id?: string } | null
}

type Category = { id?: string | null }

type ProductImage = { id?: string | null; url?: string | null }

type RequiredAttribute = {
  id: string
  name: string
  categories?: Category | Category[] | null
}

function stripPasswordFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPasswordFields)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PASSWORD_RESPONSE_FIELDS.has(key))
      .map(([key, nested]) => [key, stripPasswordFields(nested)]),
  )
}

function preventPasswordExposure(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const originalJson = res.json.bind(res)
  res.json = ((body: unknown) => originalJson(stripPasswordFields(body))) as typeof res.json
  next()
}

async function requirePublishableListing(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "thumbnail",
      "categories.id",
      "images.id",
      "images.url",
      "product_attribute_values.attribute.id",
    ],
    filters: { id: req.params.id },
  })
  const product = data[0] as {
    id: string
    thumbnail?: string | null
    categories?: Category[]
    images?: ProductImage[]
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

  if ((product.images ?? []).length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "At least one listing image is required before publication",
    )
  }

  const primaryImage = product.images?.[0]?.url
  if (primaryImage && product.thumbnail !== primaryImage) {
    const products = req.scope.resolve<IProductModuleService>(Modules.PRODUCT)
    await products.updateProducts(product.id, { thumbnail: primaryImage })
  }

  return next()
}

function recordStorefrontImpressions(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const requestId = randomUUID()
  const rawOffset = req.query.offset
  const parsedOffset = typeof rawOffset === "string" ? Number(rawOffset) : 0
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0
    ? parsedOffset
    : 0
  const originalJson = res.json.bind(res)

  res.setHeader("x-soko-request-id", requestId)
  res.json = ((body: unknown) => {
    const products = (
      body && typeof body === "object" && "products" in body
        ? (body as { products?: unknown }).products
        : undefined
    )
    const productIds = Array.isArray(products)
      ? products.flatMap((product) =>
          product && typeof product === "object" && "id" in product &&
          typeof (product as { id?: unknown }).id === "string"
            ? [(product as { id: string }).id]
            : [],
        )
      : []

    if (productIds.length === 0) {
      return originalJson(body)
    }

    const impressions = req.scope.resolve<StorefrontImpressionModuleService>(
      STOREFRONT_IMPRESSION_MODULE,
    )
    void impressions.createStorefrontImpressions(
      productIds.map((productId, index) => ({
        product_id: productId,
        position: offset + index + 1,
        request_id: requestId,
        model_version: STOREFRONT_SEARCH_MODEL_VERSION,
      })),
    ).then(() => originalJson(body)).catch(next)

    return res
  }) as typeof res.json

  next()
}

export default defineMiddlewares({
  routes: [
    ...["/admin/*", "/vendor/*", "/store/*", "/auth/*"].map((matcher) => ({
      matcher,
      middlewares: [preventPasswordExposure],
    })),
    {
      method: ["GET"],
      matcher: "/store/products",
      middlewares: [recordStorefrontImpressions],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id/confirm",
      middlewares: [requirePublishableListing],
    },
  ],
})
