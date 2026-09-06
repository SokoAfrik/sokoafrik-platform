import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { IPaymentModuleService } from "@medusajs/framework/types"

/**
 * The buyer comes back from Sifalo's hosted checkout.
 *
 * This records the session id against the cart's payment session so that
 * AUTHORIZATION — which is a server-to-server call to verify.php — has something
 * to verify. It deliberately does NOT decide whether the order is paid: the
 * customer controls this request, and the only thing that can authorise an order
 * is our own call to Sifalo plus an amount that matches what we asked for.
 *
 * A sid is SINGLE USE. Without that, a buyer who has genuinely paid once could
 * take the sid from that payment, post it against a second cart of the same
 * amount, and be handed a second order for free. The uniqueness check is what
 * closes that, and it is the reason this route exists at all rather than the
 * storefront simply passing the sid into cart completion.
 *
 * RESIDUAL RISK, recorded rather than hidden: Sifalo's verify response does not
 * carry our own order reference, so a first-use sid cannot yet be bound to the
 * cart that created it. Single-use plus the amount check is what stands in the
 * meantime. Resolve at go-live, when a real account can show whether the return
 * carries our `ref` — the return URL sends one.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { cart_id, sid } = (req.body ?? {}) as { cart_id?: string; sid?: string }

  if (!cart_id || !sid) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "cart_id and sid are both required")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const payment = req.scope.resolve<IPaymentModuleService>(Modules.PAYMENT)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.data",
      "payment_collection.payment_sessions.currency_code",
      "payment_collection.payment_sessions.amount",
    ],
    filters: { id: cart_id },
  })

  const cart = carts?.[0] as Record<string, any> | undefined
  const sessions = (cart?.payment_collection?.payment_sessions ?? []) as Record<string, any>[]
  const session = sessions.find(
    (s) => String(s.provider_id ?? "").startsWith("pp_sifalo") && s.status === "pending"
  )

  if (!session) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "this cart has no pending Sifalo payment session to return to"
    )
  }

  // SINGLE USE. A sid already recorded anywhere else is a replay.
  const existing = await payment.listPaymentSessions({} as never, {
    select: ["id", "data"],
  } as never)
  const claimed = (existing ?? []).find(
    (s: Record<string, any>) =>
      s.id !== session.id && String((s.data as Record<string, unknown>)?.sid ?? "") === sid
  )
  if (claimed) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "that payment reference has already been used for another order"
    )
  }

  // amount and currency are required by the DTO and are echoed back unchanged —
  // this route records a reference, it must never move a figure.
  await payment.updatePaymentSession({
    id: session.id,
    amount: session.amount,
    currency_code: session.currency_code ?? cart?.currency_code,
    data: { ...(session.data ?? {}), sid },
  })

  // Deliberately no verdict here. The storefront now completes the cart, which
  // is what triggers authorizePayment, which is what actually calls Sifalo.
  res.status(200).json({ recorded: true, cart_id, session_id: session.id })
}
