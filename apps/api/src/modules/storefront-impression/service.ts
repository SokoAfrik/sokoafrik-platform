import { MedusaService } from "@medusajs/framework/utils"

import StorefrontImpression from "./models/storefront-impression"

class StorefrontImpressionModuleService extends MedusaService({
  StorefrontImpression,
}) {}

export default StorefrontImpressionModuleService
