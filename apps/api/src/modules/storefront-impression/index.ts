import { Module } from "@medusajs/framework/utils"

import StorefrontImpressionModuleService from "./service"

export const STOREFRONT_IMPRESSION_MODULE = "storefrontImpression"

export default Module(STOREFRONT_IMPRESSION_MODULE, {
  service: StorefrontImpressionModuleService,
})
