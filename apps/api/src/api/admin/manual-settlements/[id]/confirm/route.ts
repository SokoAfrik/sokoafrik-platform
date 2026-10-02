import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

type ConfirmManualSettlementBody = {
  operator_ref?: unknown
}

type ManualSettlementRow = {
  id: string
  payout_id: string
  payee_id: string
  party_id: string
  msisdn: string
  network: string
  amount_minor: string
  payout_amount_minor: string
  currency: string
  payout_currency: string
  payout_status: string
  vendor_available_account_id: string | null
  settled_out_account_id: string | null
  platform_float_account_id: string | null
}

function requiredOperatorReference(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "operator_ref is required to confirm a manual settlement",
    )
  }

  return value.trim()
}

export async function POST(
  req: MedusaRequest<ConfirmManualSettlementBody>,
  res: MedusaResponse,
): Promise<void> {
  const confirmedBy = req.auth_context?.actor_id
  if (!confirmedBy) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Manual settlement confirmation requires an authenticated operator",
    )
  }

  const settlementId = req.params.id
  if (!/^\d+$/.test(settlementId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid manual settlement id")
  }
  const operatorRef = requiredOperatorReference(req.body?.operator_ref)
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const confirmed = await db.transaction(async (tx) => {
    const selected = await tx.raw(
      `SELECT m.id::text,
              m.payout_id::text,
              p.payee_id::text,
              pe.party_id::text,
              pe.msisdn,
              pe.network,
              m.amount_minor::text,
              p.amount_minor::text AS payout_amount_minor,
              m.currency::text,
              p.currency::text AS payout_currency,
              p.status::text AS payout_status,
              va.id::text AS vendor_available_account_id,
              so.id::text AS settled_out_account_id,
              pf.id::text AS platform_float_account_id
         FROM manual_settlements m
         JOIN payouts p ON p.id = m.payout_id
         JOIN payees pe ON pe.id = p.payee_id
         LEFT JOIN ledger_accounts va
           ON va.kind = 'vendor_available'
          AND va.owner_type = pe.party_type
          AND va.owner_id = pe.party_id
          AND va.currency = p.currency
         LEFT JOIN ledger_accounts so
           ON so.kind = 'settled_out'
          AND so.owner_type = pe.party_type
          AND so.owner_id = pe.party_id
          AND so.currency = p.currency
         LEFT JOIN ledger_accounts pf
           ON pf.kind = 'platform_float'
          AND pf.owner_type = 'platform'
          AND pf.owner_id IS NULL
          AND pf.currency = p.currency
        WHERE m.id = ?::bigint
          AND m.confirmed_at IS NULL
          AND m.failed_at IS NULL
        FOR UPDATE OF m, p`,
      [settlementId],
    )
    const rows = selected.rows as ManualSettlementRow[]
    if (rows.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        rows.length === 0
          ? "Manual settlement is missing or is no longer open"
          : "Duplicate payout ledger accounts",
      )
    }
    const [row] = rows
    if (row.payout_status !== "pending") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Payout is not pending")
    }
    if (row.amount_minor !== row.payout_amount_minor) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Manual settlement amount does not match payout amount",
      )
    }
    if (row.currency !== row.payout_currency) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Manual settlement currency does not match payout currency",
      )
    }
    if (!row.vendor_available_account_id
      || !row.settled_out_account_id
      || !row.platform_float_account_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payout ledger accounts are missing",
      )
    }

    const updated = await tx("manual_settlements")
      .where({ id: settlementId })
      .whereNull("confirmed_at")
      .whereNull("failed_at")
      .update({
        operator_ref: operatorRef,
        confirmed_by: confirmedBy,
        confirmed_at: tx.fn.now(),
      })
    if (updated !== 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Manual settlement could not be confirmed",
      )
    }

    const [transfer] = await tx("ledger_transfers")
      .insert({ transfer_id: tx.raw("gen_random_uuid()") })
      .returning("transfer_id")
    await tx("ledger_entries").insert([
      {
        transfer_id: transfer.transfer_id,
        account_id: row.vendor_available_account_id,
        amount_minor: row.payout_amount_minor,
        currency: row.payout_currency,
        reason: "payout_confirmed",
        payout_id: row.payout_id,
      },
      {
        transfer_id: transfer.transfer_id,
        account_id: row.platform_float_account_id,
        amount_minor: `-${row.payout_amount_minor}`,
        currency: row.payout_currency,
        reason: "payout_confirmed",
        payout_id: row.payout_id,
      },
    ])
    await tx("payouts")
      .where({ id: row.payout_id, status: "pending" })
      .update({ status: "paid", settled_at: tx.fn.now() })
    await tx("notification_outbox").insert({
      channel: "sms",
      to_msisdn: row.msisdn,
      party_type: "vendor",
      party_id: row.party_id,
      template: "payout_paid",
      locale: "so",
      vars: JSON.stringify({
        amount_minor: row.payout_amount_minor,
        currency: row.payout_currency,
        wallet: row.network.replace("_", " "),
        last4: row.msisdn.slice(-4),
        ref: `SOKO-${row.payout_id}`,
      }),
    })

    return row
  })

  res.status(200).json({
    settlement: {
      id: confirmed.id,
      payout_id: confirmed.payout_id,
      status: "confirmed",
      operator_ref: operatorRef,
    },
  })
}
