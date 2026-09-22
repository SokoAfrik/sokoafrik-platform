import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

type CreatePayoutDestinationBody = {
  bank_name?: unknown
  bank_account_no?: unknown
  bank_account_name?: unknown
  swift?: unknown
}

type PayoutDestination = {
  id: string
  bank_name: string
  bank_account_no: string
  bank_account_name: string
  swift: string | null
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${field} is required`,
    )
  }

  return value.trim()
}

export async function POST(
  req: AuthenticatedMedusaRequest<CreatePayoutDestinationBody>,
  res: MedusaResponse<{ payout_destination: PayoutDestination }>,
): Promise<void> {
  const sellerId = req.seller_context.seller_id
  const bankName = requiredText(req.body.bank_name, "bank_name")
  const bankAccountNo = requiredText(
    req.body.bank_account_no,
    "bank_account_no",
  )
  const bankAccountName = requiredText(
    req.body.bank_account_name,
    "bank_account_name",
  )
  const swift = req.body.swift == null || req.body.swift === ""
    ? null
    : requiredText(req.body.swift, "swift")
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const created = await db.transaction(async (tx) => {
    const vendor = await tx("vendor_identity as vi")
      .join("vendor_profiles as vp", "vp.vendor_id", "vi.vendor_id")
      .select("vi.vendor_id", "vp.contact_phone")
      .where("vi.seller_id", sellerId)
      .first()

    if (!vendor?.contact_phone) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Complete the vendor profile and contact phone before adding a payout destination",
      )
    }

    await tx.raw("SELECT pg_advisory_xact_lock(?::bigint)", [
      String(vendor.vendor_id),
    ])

    const existing = await tx("payees")
      .select("id")
      .where({ party_type: "vendor", party_id: vendor.vendor_id })
      .first()

    if (existing) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A payout destination already exists for this vendor",
      )
    }

    const [destination] = await tx("payees")
      .insert({
        party_type: "vendor",
        party_id: vendor.vendor_id,
        msisdn: vendor.contact_phone,
        network: "EVC_PLUS",
        account_holder: bankAccountName,
        destination: "bank_account",
        bank_name: bankName,
        bank_account_no: bankAccountNo,
        bank_account_name: bankAccountName,
        bank_swift: swift,
      })
      .returning([
        tx.raw("id::text AS id"),
        "bank_name",
        "bank_account_no",
        "bank_account_name",
        tx.raw("bank_swift AS swift"),
      ])

    return destination as PayoutDestination
  })

  res.status(201).json({ payout_destination: created })
}
