import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const DEFAULT_LIMIT = 100
const DEFAULT_LEASE_SECONDS = 300

type ReleaseOptions = {
  now?: Date
  limit?: number
  leaseSeconds?: number
  claimToken?: string
}

type ClaimedRelease = {
  queue_id: string
  sub_order_id: string
  claim_token: string
}

export async function releaseDueEscrow(
  container: MedusaContainer,
  options: ReleaseOptions = {}
) {
  const now = options.now ?? new Date()
  const limit = options.limit ?? DEFAULT_LIMIT
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  if (Number.isNaN(now.getTime())) throw new Error("Escrow release time must be valid")
  if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_LIMIT) {
    throw new Error(`Escrow release limit must be an integer from 1 to ${DEFAULT_LIMIT}`)
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error("Escrow release lease must be a positive number of seconds")
  }

  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const claimToken = options.claimToken ?? randomUUID()
  const claims = await db.transaction(async (tx: any) => {
    const claimed = await tx.raw(
      `WITH due AS (
         SELECT id
           FROM escrow_release_queue
          WHERE release_at <= ?::timestamptz
            AND completed_at IS NULL
            AND (claim_expires_at IS NULL OR claim_expires_at <= ?::timestamptz)
          ORDER BY release_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ?
       )
       UPDATE escrow_release_queue q
          SET claim_token = ?::uuid,
              claimed_at = ?::timestamptz,
              claim_expires_at = ?::timestamptz + (?::integer * interval '1 second')
         FROM due
        WHERE q.id = due.id
        RETURNING q.id::text AS queue_id,
                  q.sub_order_id::text,
                  q.claim_token::text`,
      [now, now, limit, claimToken, now, now, leaseSeconds]
    )
    return claimed.rows as ClaimedRelease[]
  })

  const released: Array<{ queueId: string; subOrderId: string; transferId: string }> = []
  for (const claim of claims) {
    const result = await db.transaction(async (tx: any) => {
      const queue = await tx("escrow_release_queue")
        .select("id")
        .where({ id: claim.queue_id, claim_token: claim.claim_token })
        .whereNull("completed_at")
        .forUpdate()
        .first()
      if (!queue) return null

      const held = await tx.raw(
        `SELECT a.id::text AS escrow_account_id,
                a.owner_id::text AS vendor_id,
                a.currency::text AS currency,
                COALESCE(-SUM(e.amount_minor), 0)::bigint::text AS gross_minor
           FROM ledger_accounts a
           JOIN ledger_entries e ON e.account_id = a.id
          WHERE a.kind = 'escrow_held'
            AND a.owner_type = 'vendor'
            AND e.sub_order_id = ?::bigint
          GROUP BY a.id, a.owner_id, a.currency`,
        [claim.sub_order_id]
      )
      if (held.rows.length !== 1 || held.rows[0].vendor_id === null) {
        throw new Error("Queued escrow release must resolve to one vendor escrow account")
      }

      const { escrow_account_id, vendor_id, currency, gross_minor } = held.rows[0]
      const grossMinor = BigInt(gross_minor)
      if (grossMinor <= 0n) throw new Error("Queued escrow release must have positive held funds")

      const commission = await tx.raw(
        `SELECT FLOOR(?::numeric * COALESCE(commission_pct, 0) / 100)::bigint::text
                  AS commission_minor
           FROM (SELECT ?::bigint AS vendor_id) wanted
           LEFT JOIN vendor_profiles USING (vendor_id)`,
        [grossMinor.toString(), vendor_id]
      )
      const commissionMinor = BigInt(commission.rows[0].commission_minor)
      if (commissionMinor < 0n || commissionMinor >= grossMinor) {
        throw new Error("Escrow release commission must be non-negative and less than gross")
      }
      const vendorMinor = grossMinor - commissionMinor

      let vendorAvailable = await tx("ledger_accounts")
        .select("id")
        .where({
          kind: "vendor_available",
          owner_type: "vendor",
          owner_id: vendor_id,
          currency,
        })
        .first()
      if (!vendorAvailable) {
        ;[vendorAvailable] = await tx("ledger_accounts")
          .insert({
            kind: "vendor_available",
            owner_type: "vendor",
            owner_id: vendor_id,
            currency,
          })
          .returning("id")
      }

      let platformRevenue: { id: string } | undefined
      if (commissionMinor > 0n) {
        platformRevenue = await tx("ledger_accounts")
          .select("id")
          .where({ kind: "platform_revenue", owner_type: "platform", currency })
          .whereNull("owner_id")
          .first()
        if (!platformRevenue) {
          ;[platformRevenue] = await tx("ledger_accounts")
            .insert({
              kind: "platform_revenue",
              owner_type: "platform",
              owner_id: null,
              currency,
            })
            .returning("id")
        }
      }

      const transferId = (await tx.raw("SELECT gen_random_uuid() AS id")).rows[0].id
      await tx("ledger_transfers").insert({ transfer_id: transferId })
      const legs = [
        {
          transfer_id: transferId,
          account_id: escrow_account_id,
          amount_minor: grossMinor.toString(),
          currency,
          reason: "release",
          sub_order_id: claim.sub_order_id,
        },
        {
          transfer_id: transferId,
          account_id: vendorAvailable.id,
          amount_minor: (-vendorMinor).toString(),
          currency,
          reason: "release",
          sub_order_id: claim.sub_order_id,
        },
      ]
      if (commissionMinor > 0n) {
        legs.push({
          transfer_id: transferId,
          account_id: platformRevenue!.id,
          amount_minor: (-commissionMinor).toString(),
          currency,
          reason: "commission",
          sub_order_id: claim.sub_order_id,
        })
      }
      await tx("ledger_entries").insert(legs)

      const completed = await tx("escrow_release_queue")
        .where({ id: claim.queue_id, claim_token: claim.claim_token })
        .whereNull("completed_at")
        .update({ completed_at: now })
      if (completed !== 1) throw new Error("Escrow release claim was lost before completion")
      return { queueId: claim.queue_id, subOrderId: claim.sub_order_id, transferId }
    })
    if (result) released.push(result)
  }

  return { claimed: claims.length, released }
}

export default async function releaseDueEscrowJob(container: MedusaContainer) {
  await releaseDueEscrow(container)
}

export const config = {
  name: "release-due-escrow",
  schedule: "* * * * *",
}
