import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type StagedBankVerification = {
  id: string
  payee_id: string
  vendor_id: string
  amount_minor: number
  currency: "USD"
  sent_at: string
  expires_at: string
  bank_name: string
  bank_account_no: string
  bank_account_name: string
  swift: string | null
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse<{ bank_verifications: StagedBankVerification[] }>,
): Promise<void> {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const rows = await db("bank_verifications as bv")
    .join("payees as p", "p.id", "bv.payee_id")
    .select(
      "bv.id",
      "bv.payee_id",
      "p.party_id as vendor_id",
      "bv.amount_minor",
      "bv.sent_at",
      "bv.expires_at",
      "bv.bank_name_at_issue as bank_name",
      "bv.bank_account_no_at_issue as bank_account_no",
      "bv.bank_account_name_at_issue as bank_account_name",
      "bv.bank_swift_at_issue as swift",
    )
    .where("p.party_type", "vendor")
    .where("p.destination", "bank_account")
    .whereNull("bv.verified_at")
    .orderBy("bv.sent_at", "asc")
    .orderBy("bv.id", "asc")

  res.status(200).json({
    bank_verifications: rows.map((row) => ({
      id: String(row.id),
      payee_id: String(row.payee_id),
      vendor_id: String(row.vendor_id),
      amount_minor: Number(row.amount_minor),
      currency: "USD" as const,
      sent_at: new Date(row.sent_at).toISOString(),
      expires_at: new Date(row.expires_at).toISOString(),
      bank_name: String(row.bank_name),
      bank_account_no: String(row.bank_account_no),
      bank_account_name: String(row.bank_account_name),
      swift: row.swift == null ? null : String(row.swift),
    })),
  })
}
