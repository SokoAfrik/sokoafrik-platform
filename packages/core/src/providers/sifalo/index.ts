import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SifaloPaymentProvider from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [SifaloPaymentProvider],
})

export { SifaloPaymentProvider }
export * from "./client"
