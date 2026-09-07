import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
} from "@medusajs/framework/types"
import { MedusaError, PaymentSessionStatus } from "@medusajs/framework/utils"
import { SifaloPaymentProvider } from "@mercurjs/core/providers/sifalo"

const SIFALO_CHECKOUT_BASE = "https://pay.sifalo.com/checkout/"

const toMinor = (amount: unknown): bigint => {
  const value = String(amount)
  if (!/^\d+$/.test(value)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Sifalo payment amount must be integer minor units, got ${value}`
    )
  }
  return BigInt(value)
}

/**
 * App-owned Sifalo provider.
 *
 * Sifalo's official WooCommerce integration records `order_id` when opening a
 * hosted checkout, then uses that value to recover paid sessions whose browser
 * never returned with a `sid`. Mercur's base provider already owns all other
 * authorization and amount-match behavior; this override adds that recoverable
 * reference without changing the money verdict.
 */
export default class SokoAfrikSifaloPaymentProvider extends SifaloPaymentProvider {
  static identifier = "sifalo"

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const authorization = await super.authorizePayment(input)
    if (authorization.status !== PaymentSessionStatus.AUTHORIZED) {
      return authorization
    }

    return { ...authorization, status: PaymentSessionStatus.CAPTURED }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const expectedMinor = toMinor(input.amount)
    const currency = String(input.currency_code ?? "USD").toUpperCase()
    const orderRef = String(
      (input.context as Record<string, unknown> | undefined)?.session_id ??
        (input.data as Record<string, unknown> | undefined)?.session_id ??
        `cart-${Date.now()}`
    )
    const amount = `${expectedMinor / 100n}.${String(expectedMinor % 100n).padStart(2, "0")}`

    let response: Response
    try {
      response = await fetch(`${this.options_.baseUrl ?? "https://api.sifalopay.com"}/gateway/`, {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.options_.username}:${this.options_.key}`).toString("base64"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount,
          gateway: "checkout",
          currency,
          order_id: orderRef,
          return_url: `${this.options_.returnUrl}?ref=${encodeURIComponent(orderRef)}`,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Sifalo did not open a checkout session: ${String(error)}`
      )
    }

    const session = (await response.json()) as { key?: string; token?: string }
    if (!session.key || !session.token) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Sifalo did not open a checkout session: gateway returned no key/token"
      )
    }

    return {
      id: orderRef,
      data: {
        sifalo_key: session.key,
        sifalo_token: session.token,
        checkout_url: `${this.options_.checkoutBaseUrl ?? SIFALO_CHECKOUT_BASE}?key=${encodeURIComponent(session.key)}&token=${encodeURIComponent(session.token)}`,
        order_ref: orderRef,
        expected_amount_minor: expectedMinor.toString(),
        currency,
      },
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const expected = String(data.expected_amount_minor ?? "")
    const wanted = toMinor(input.amount).toString()
    if (expected && expected === wanted) {
      return { data }
    }

    const reopened = await this.initiatePayment(
      input as unknown as InitiatePaymentInput
    )
    return { data: { ...data, ...(reopened.data ?? {}) } }
  }
}
