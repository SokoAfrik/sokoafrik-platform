import type {
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { completeCartWithSplitOrdersWorkflow } from "@mercurjs/core/workflows"

const FIFTEEN_MINUTES = 15 * 60 * 1000

type SweepOptions = {
  minimumAgeMs?: number
  now?: Date
}

export async function sweepPaidSifaloSessions(
  container: MedusaContainer,
  options: SweepOptions = {}
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const payment = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const minimumAgeMs = options.minimumAgeMs ?? FIFTEEN_MINUTES
  const now = options.now ?? new Date()
  const verifyBase = process.env.SIFALO_BASE_URL ?? "https://api.sifalopay.com"

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "currency_code",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.data",
      "payment_collection.payment_sessions.amount",
      "payment_collection.payment_sessions.currency_code",
      "payment_collection.payment_sessions.created_at",
    ],
  })

  const completed: Array<{ cartId: string; orderGroupId: string }> = []
  const failures: Array<{ cartId: string; message: string }> = []

  for (const cart of (carts ?? []) as Record<string, any>[]) {
    if (cart.completed_at) continue

    const sessions = cart.payment_collection?.payment_sessions ?? []
    for (const session of sessions as Record<string, any>[]) {
      if (
        !String(session.provider_id ?? "").startsWith("pp_sifalo") ||
        !["pending", "authorized", "captured"].includes(session.status)
      ) {
        continue
      }

      const createdAt = new Date(session.created_at).getTime()
      if (
        minimumAgeMs > 0 &&
        (!Number.isFinite(createdAt) || now.getTime() - createdAt < minimumAgeMs)
      ) {
        continue
      }

      if (session.status === "pending") {
        let sid = String(session.data?.sid ?? "")
        if (!sid) {
          const orderRef = String(session.data?.order_ref ?? "")
          if (!orderRef) continue

          let lookup: Record<string, unknown>
          try {
            const response = await fetch(`${verifyBase}/gateway/verify.php`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_id: orderRef }),
              signal: AbortSignal.timeout(30_000),
            })
            lookup = (await response.json()) as Record<string, unknown>
          } catch {
            continue
          }

          sid = String(lookup.sid ?? "")
          if (String(lookup.status ?? "").toLowerCase() !== "success" || !sid) {
            continue
          }

          await payment.updatePaymentSession({
            id: session.id,
            amount: session.amount,
            currency_code: session.currency_code ?? cart.currency_code,
            data: { ...(session.data ?? {}), sid },
          })
        }

        const authorized = await payment.authorizePaymentSession(session.id, {})
        if (!authorized) continue
      }

      const { errors, result } = await completeCartWithSplitOrdersWorkflow(container).run({
        input: { cart_id: cart.id },
        throwOnError: false,
      })
      if (!errors?.length && result?.order_group_id) {
        completed.push({ cartId: cart.id, orderGroupId: result.order_group_id })
      } else {
        failures.push({
          cartId: cart.id,
          message: errors?.[0]?.error?.message ?? "cart completion returned no order group",
        })
      }
    }
  }

  return { completed, failures }
}

export default async function sweepSifaloPayments(container: MedusaContainer) {
  await sweepPaidSifaloSessions(container)
}

export const config = {
  name: "sweep-sifalo-payments",
  schedule: "*/15 * * * *",
}
