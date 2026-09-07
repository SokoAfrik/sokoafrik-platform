import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SokoAfrikSifaloPaymentProvider from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [SokoAfrikSifaloPaymentProvider],
})
