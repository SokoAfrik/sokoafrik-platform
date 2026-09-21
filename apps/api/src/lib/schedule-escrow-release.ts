type ScheduleEscrowReleaseInput = {
  subOrderId: string
  deliveredAt: Date
}

/**
 * Stamp the money-layer release queue from the marketplace delivery event.
 *
 * This is deliberately the same transaction shape as soko-money's
 * scheduleEscrowRelease: the captured escrow account is the authority for the
 * vendor, and locking it serializes the first-ten-order hold decision.
 */
export async function scheduleEscrowRelease(
  db: any,
  input: ScheduleEscrowReleaseInput
): Promise<void> {
  if (!/^[1-9][0-9]*$/.test(input.subOrderId)) {
    throw new Error("Escrow release sub-order ID must be a positive integer")
  }
  if (Number.isNaN(input.deliveredAt.getTime())) {
    throw new Error("Escrow release delivery time must be valid")
  }

  await db.transaction(async (tx: any) => {
    const captured = await tx.raw(
      `SELECT a.id::text
         FROM ledger_accounts a
        WHERE a.kind = 'escrow_held'
          AND a.owner_type = 'vendor'
          AND EXISTS (
            SELECT 1
              FROM ledger_entries e
             WHERE e.account_id = a.id
               AND e.sub_order_id = ?::bigint
               AND e.reason = 'capture'
          )
        ORDER BY a.id
        FOR UPDATE OF a`,
      [input.subOrderId]
    )
    if (captured.rows.length !== 1) {
      throw new Error("Escrow release sub-order must have one captured vendor escrow account")
    }

    const count = await tx.raw(
      `SELECT COUNT(DISTINCT q.sub_order_id)::text AS scheduled_count
         FROM escrow_release_queue q
         JOIN ledger_entries e
           ON e.sub_order_id = q.sub_order_id
          AND e.account_id = ?`,
      [captured.rows[0].id]
    )
    const isNewVendorOrder = BigInt(count.rows[0].scheduled_count) < 10n

    const inserted = await tx.raw(
      `INSERT INTO escrow_release_queue (sub_order_id, release_at)
       SELECT ?::bigint,
              ?::timestamptz
                + (CASE WHEN ?::boolean THEN 7 ELSE value::integer END * interval '1 day')
         FROM onboarding_rules
        WHERE key = 'escrow_hold_days'
       ON CONFLICT (sub_order_id) DO NOTHING
       RETURNING id`,
      [input.subOrderId, input.deliveredAt, isNewVendorOrder]
    )
    if (inserted.rows.length === 0) {
      const existing = await tx("escrow_release_queue")
        .select("id")
        .where({ sub_order_id: input.subOrderId })
        .first()
      if (!existing) throw new Error("escrow_hold_days setting is missing")
    }
  })
}
