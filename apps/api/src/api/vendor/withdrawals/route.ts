import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

type CreateWithdrawalBody = {
  amount_minor?: unknown
  currency?: unknown
}

type WithdrawalResponse = {
  withdrawal: {
    id: string
    amount_minor: number
    currency: string
    status: "requested"
  }
}

function requiredAmountMinor(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "amount_minor must be a positive integer in minor units",
    )
  }

  return BigInt(value)
}

function requiredCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "currency must be a three-letter code",
    )
  }

  return value.toUpperCase()
}

export async function POST(
  req: AuthenticatedMedusaRequest<CreateWithdrawalBody>,
  res: MedusaResponse<WithdrawalResponse>,
): Promise<void> {
  const sellerId = req.seller_context.seller_id
  const amountMinor = requiredAmountMinor(req.body.amount_minor)
  const currency = requiredCurrency(req.body.currency)
  const sellerCurrency = req.seller_context.currency_code.toUpperCase()
  if (currency !== sellerCurrency) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Withdrawals for this vendor must use ${sellerCurrency}`,
    )
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const created = await db.transaction(async (tx) => {
    const payee = await tx("vendor_identity as vi")
      .join("payable_destinations as pd", function joinDestination() {
        this.on("pd.party_id", "=", "vi.vendor_id")
          .andOnVal("pd.party_type", "=", "vendor")
      })
      .select("pd.payee_id", "pd.destination", "pd.blocked_reason")
      .where("vi.seller_id", sellerId)
      .first()

    if (!payee) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Add a payout destination before requesting a withdrawal",
      )
    }
    if (payee.destination !== "bank_account" || payee.blocked_reason) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        payee.blocked_reason ?? "Only verified bank payout destinations can withdraw",
      )
    }

    await tx.raw("SELECT pg_advisory_xact_lock(?::bigint)", [String(payee.payee_id)])

    const openRequest = await tx("withdrawal_requests")
      .select("id")
      .where("payee_id", payee.payee_id)
      .whereIn("status", ["requested", "queued"])
      .first()
    if (openRequest) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A withdrawal request is already open for this vendor",
      )
    }

    const balance = await tx("vendor_withdrawable")
      .select(tx.raw("available_minor::text AS available_minor"))
      .where({ payee_id: payee.payee_id, currency })
      .first()
    const availableMinor = BigInt(balance?.available_minor ?? 0)
    if (amountMinor > availableMinor) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Withdrawal amount exceeds the available vendor balance",
      )
    }

    const [withdrawal] = await tx("withdrawal_requests")
      .insert({
        payee_id: payee.payee_id,
        amount_minor: amountMinor,
        currency,
        requested_by: "vendor_web",
      })
      .returning(["id", "amount_minor", "currency", "status"])

    return withdrawal
  })

  res.status(201).json({
    withdrawal: {
      id: String(created.id),
      amount_minor: Number(created.amount_minor),
      currency: created.currency,
      status: created.status,
    },
  })
}
