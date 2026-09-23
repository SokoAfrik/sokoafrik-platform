import { randomInt } from "node:crypto"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY2346789"
const MAX_ATTEMPTS = 5

type VerifyPayoutDestinationBody = {
  code?: unknown
}

type VerificationResponse = {
  verification: {
    id: string
    status: "staged" | "verified"
    amount_minor?: number
    currency?: "USD"
    expires_at?: string
  }
}

function verificationCode(): string {
  let code = ""
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)]
  }
  return code
}

function enteredCode(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "code must be text")
  }
  return value.replace(/\s+/g, "").toUpperCase()
}

export async function POST(
  req: AuthenticatedMedusaRequest<VerifyPayoutDestinationBody>,
  res: MedusaResponse<VerificationResponse>,
): Promise<void> {
  const sellerId = req.seller_context.seller_id
  const code = enteredCode(req.body.code)
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const result = await db.transaction(async (tx) => {
    const payee = await tx("payees as p")
      .join("vendor_identity as vi", function joinVendor() {
        this.on("vi.vendor_id", "=", "p.party_id")
          .andOnVal("p.party_type", "=", "vendor")
      })
      .select(
        "p.id",
        "p.bank_name",
        "p.bank_account_no",
        "p.bank_account_name",
        "p.bank_swift",
      )
      .where("vi.seller_id", sellerId)
      .where("p.destination", "bank_account")
      .first()

    if (!payee) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Add a bank payout destination before verifying it",
      )
    }

    await tx.raw("SELECT pg_advisory_xact_lock(?::bigint)", [String(payee.id)])

    if (code === null) {
      const generated = verificationCode()
      const inserted = await tx.raw(
        `INSERT INTO bank_verifications
           (payee_id, code, amount_minor, sent_at, expires_at,
            bank_name_at_issue, bank_account_no_at_issue,
            bank_account_name_at_issue, bank_swift_at_issue)
         VALUES (?, ?, 5, now(), now() + interval '14 days', ?, ?, ?, ?)
         ON CONFLICT (payee_id) WHERE verified_at IS NULL
         DO NOTHING
         RETURNING id::text, expires_at`,
        [
          payee.id,
          generated,
          payee.bank_name,
          payee.bank_account_no,
          payee.bank_account_name,
          payee.bank_swift,
        ],
      )

      if (inserted.rows.length !== 1) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "A bank verification is already open for this payout destination",
        )
      }

      return {
        id: inserted.rows[0].id as string,
        status: "staged" as const,
        amount_minor: 5,
        currency: "USD" as const,
        expires_at: (inserted.rows[0].expires_at as Date).toISOString(),
      }
    }

    const verification = await tx("bank_verifications")
      .select(
        "id",
        "code",
        "expires_at",
        "attempts",
        "verified_at",
        "bank_name_at_issue",
        "bank_account_no_at_issue",
        "bank_account_name_at_issue",
        "bank_swift_at_issue",
      )
      .where("payee_id", payee.id)
      .whereNull("verified_at")
      .forUpdate()
      .first()

    if (!verification) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No open bank verification exists for this payout destination",
      )
    }
    if (verification.attempts >= MAX_ATTEMPTS) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Bank verification has too many failed attempts",
      )
    }
    if (new Date() > new Date(verification.expires_at)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Bank verification has expired")
    }
    if (code.length === 0 || code !== String(verification.code).toUpperCase()) {
      await tx("bank_verifications")
        .where("id", verification.id)
        .increment("attempts", 1)
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Bank verification code is incorrect")
    }

    const marked = await tx("payees")
      .where({ id: payee.id, destination: "bank_account" })
      .where("bank_name", verification.bank_name_at_issue)
      .where("bank_account_no", verification.bank_account_no_at_issue)
      .where("bank_account_name", verification.bank_account_name_at_issue)
      .whereRaw("bank_swift IS NOT DISTINCT FROM ?::text", [
        verification.bank_swift_at_issue,
      ])
      .update({
        bank_verified_at: tx.fn.now(),
        bank_verified_by: "micro_deposit",
      })
      .returning("id")

    if (marked.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The payout destination changed after the verification was issued",
      )
    }

    await tx("bank_verifications")
      .where("id", verification.id)
      .update({ verified_at: tx.fn.now() })

    return { id: String(verification.id), status: "verified" as const }
  })

  res.status(result.status === "staged" ? 201 : 200).json({ verification: result })
}
