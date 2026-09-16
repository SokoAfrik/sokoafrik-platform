import { model } from "@medusajs/framework/utils"

const StorefrontImpression = model
  .define("storefront_impression", {
    id: model.id({ prefix: "simp" }).primaryKey(),
    product_id: model.text(),
    position: model.number(),
    request_id: model.text(),
    model_version: model.text(),
  })
  .indexes([
    { on: ["request_id", "position"], unique: true },
    { on: ["product_id", "created_at"] },
  ])

export default StorefrontImpression
