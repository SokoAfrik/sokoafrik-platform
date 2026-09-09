import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type VendorBalanceResponse = {
  balance: {
    available_minor: string
    currency: string
    has_open_request: boolean
  }
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<VendorBalanceResponse>
): Promise<void> {
  const sellerId = req.seller_context.seller_id
  const currency = req.seller_context.currency_code.toUpperCase()
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const balance = await db("vendor_identity as vi")
    .join("vendor_withdrawable as vw", function () {
      this.on("vw.party_id", "=", "vi.vendor_id")
        .andOnVal("vw.party_type", "=", "vendor")
        .andOnVal("vw.currency", "=", currency)
    })
    .select(
      db.raw("vw.available_minor::text AS available_minor"),
      "vw.currency",
      "vw.has_open_request"
    )
    .where("vi.seller_id", sellerId)
    .first()

  res.json({
    balance: balance ?? {
      available_minor: "0",
      currency,
      has_open_request: false,
    },
  })
}
