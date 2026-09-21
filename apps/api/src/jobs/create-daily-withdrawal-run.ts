import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type WithdrawalRunOptions = {
  runDate?: string
}

type CreatedWithdrawal = {
  request_id: string
  payout_id: string
  batch_id: string
}

export async function createDailyWithdrawalRun(
  container: MedusaContainer,
  options: WithdrawalRunOptions = {}
) {
  const runDate = options.runDate ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw new Error("Withdrawal run date must be YYYY-MM-DD")
  }

  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const created = await db.raw(
    `SELECT request_id::text, payout_id::text, batch_id::text
       FROM create_daily_withdrawal_run(?::date)`,
    [runDate]
  )

  return created.rows as CreatedWithdrawal[]
}

export default async function createDailyWithdrawalRunJob(container: MedusaContainer) {
  await createDailyWithdrawalRun(container)
}

export const config = {
  name: "create-daily-withdrawal-run",
  schedule: "0 6 * * *",
}
