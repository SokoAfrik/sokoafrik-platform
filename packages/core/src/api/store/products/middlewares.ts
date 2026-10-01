import {
  applyDefaultFilters,
  authenticate,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  isPresent,
} from "@medusajs/framework/utils";
import { validateAndTransformQuery } from "@medusajs/framework";
import {
  normalizeDataForContext,
  setPricingContext,
  setTaxContext,
} from "@medusajs/medusa/api/utils/middlewares/index";

import { storeProductQueryConfig } from "./query-config";
import { StoreGetProductParams, StoreGetProductsParams } from "./validators";
import { MercurModules, ProductStatus } from "@mercurjs/types";
import type ProductAttributeModuleService from "../../../modules/product-attribute/service";

/**
 * Apply the store-facing defaults that vanilla Medusa applies on its own
 * `/store/products` route. Besides forcing the `published` status, this
 * translates the Medusa-standard `category_id` query param into the
 * `categories` relation filter. The `Product` entity has no `category_id`
 * column, so passing it straight to `query.graph` raises
 * `Trying to query by not existing property Product.category_id` (#974).
 */
const applyProductFilters = applyDefaultFilters({
  status: ProductStatus.PUBLISHED,
  categories: (filters: Record<string, unknown>) => {
    const categoryIds = filters.category_id;
    delete filters.category_id;

    if (!isPresent(categoryIds)) {
      return;
    }

    return { id: categoryIds, is_internal: false, is_active: true };
  },
});

/**
 * Translate global product-attribute filters (`attributes[<handle>]=v1,v2`)
 * into native variant-option filters. Every filterable global attribute is a
 * variant axis backed by a linked product-attribute value. Resolve matching
 * product ids per attribute and intersect them (AND across attributes), while
 * multiple values within one attribute remain OR'd. Binding each value query
 * to the resolved attribute id keeps identical values from unrelated
 * attributes from matching the same filter.
 */
async function transformAttributeFilters(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const filters = (req.filterableFields ??= {}) as Record<string, unknown>;
  const attributes = filters.attributes as
    | Record<string, string | string[]>
    | undefined;
  delete filters.attributes;

  if (!attributes) {
    return next();
  }

  const handles = Object.keys(attributes);
  const attributeService = req.scope.resolve<ProductAttributeModuleService>(
    MercurModules.PRODUCT_ATTRIBUTE,
  );
  const resolvedAttributes = await attributeService.listProductAttributes(
    { handle: handles },
    { select: ["id", "handle"] },
  );
  const attributeIdByHandle = new Map(
    resolvedAttributes.map((attribute) => [attribute.handle, attribute.id]),
  );

  const filtersByAttribute = Object.entries(attributes)
    .map(([handle, value]) => ({
      attributeId: attributeIdByHandle.get(handle) ?? `missing:${handle}`,
      values: (Array.isArray(value) ? value : String(value).split(","))
        .map((entry) => entry.trim())
        .filter(Boolean),
    }))
    .filter(({ values }) => values.length > 0);

  if (filtersByAttribute.length > 0) {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const productIdSets = await Promise.all(
      filtersByAttribute.map(async ({ attributeId, values }) => {
        const rows = await db("product_attribute_value_link as link")
          .join(
            "product_attribute_value as value",
            "value.id",
            "link.product_attribute_value_id",
          )
          .where("value.attribute_id", attributeId)
          .whereIn("value.name", values)
          .whereNull("value.deleted_at")
          .select("link.product_id");

        return new Set<string>(
          rows.map((row: { product_id: string }) => row.product_id),
        );
      }),
    );
    const [first = new Set<string>(), ...rest] = productIdSets;
    const matchingIds = [...first].filter((id) =>
      rest.every((ids) => ids.has(id)),
    );
    const existingIds = filters.id
      ? new Set(Array.isArray(filters.id) ? filters.id : [filters.id])
      : null;
    const filteredIds = existingIds
      ? matchingIds.filter((id) => existingIds.has(id))
      : matchingIds;
    filters.id =
      filteredIds.length > 0 ? filteredIds : ["attribute-filter:no-match"];
  }

  next();
}

/**
 * Resolve the pricing/tax context consumed by the offer-price wrap. Reuses
 * Medusa's product-pricing middlewares so the gate matches vanilla
 * `/store/products`: prices compute only when the client requests
 * `variants.calculated_price` or passes `region_id`.
 */
const pricingMiddlewares = [
  authenticate("customer", ["session", "bearer"], {
    allowUnauthenticated: true,
  }),
  normalizeDataForContext({ priceFieldPaths: ["variants.calculated_price"] }),
  setPricingContext({ priceFieldPaths: ["variants.calculated_price"] }),
  setTaxContext({ priceFieldPaths: ["variants.calculated_price"] }),
];

export const storeProductsMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET"],
    matcher: "/store/products",
    middlewares: [
      validateAndTransformQuery(
        StoreGetProductsParams,
        storeProductQueryConfig.list,
      ),
      applyProductFilters,
      transformAttributeFilters,
      ...pricingMiddlewares,
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/products/:id",
    middlewares: [
      validateAndTransformQuery(
        StoreGetProductParams,
        storeProductQueryConfig.retrieve,
      ),
      applyProductFilters,
      ...pricingMiddlewares,
    ],
  },
];
