import { model } from "@medusajs/framework/utils"

/**
 * SokoAfrik changes to Mercur's review model. Three of them:
 *
 *  1. `reference` gains "driver". Riders carry other people's goods; a marketplace
 *     that rates the shop but not the person who turned up at the door is missing
 *     the half customers actually complain about.
 *  2. `reference_id` is now STORED, not only implied by a module link. Products and
 *     sellers are Medusa modules so a link works; drivers live in SokoAfrik's own
 *     delivery layer and have no module to link to. Storing the id also makes
 *     "show me every review of X" one query instead of a link traversal.
 *  3. `images` — buyer photos. On a marketplace whose whole pitch is that you can
 *     trust a stranger, a picture of what actually arrived is worth more than five
 *     stars. Stored as file references from our own file module, never raw URLs.
 */
const Review = model.define("review", {
  id: model.id({ prefix: "rev" }).primaryKey(),
  display_id: model.autoincrement(),
  reference: model.enum(["product", "seller", "driver"]),
  reference_id: model.text().nullable(),
  rating: model.number(),
  customer_note: model.text().searchable().nullable(),
  seller_note: model.text().searchable().nullable(),
  images: model.json().nullable(),
  status: model.enum(["pending", "published", "rejected"]).default("pending"),
})

export default Review
