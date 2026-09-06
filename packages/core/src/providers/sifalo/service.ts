import { AbstractPaymentProvider, MedusaError, PaymentSessionStatus } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type {
  AuthorizePaymentInput, AuthorizePaymentOutput,
  CancelPaymentInput, CancelPaymentOutput,
  CapturePaymentInput, CapturePaymentOutput,
  DeletePaymentInput, DeletePaymentOutput,
  GetPaymentStatusInput, GetPaymentStatusOutput,
  InitiatePaymentInput, InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput, RefundPaymentOutput,
  RetrievePaymentInput, RetrievePaymentOutput,
  UpdatePaymentInput, UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"

import { SifaloClient, isPaidCorrectly, parseAmount } from "./client"

export interface SifaloOptions {
  username: string
  key: string
  returnUrl: string
  /** Overridden in tests to point at a stub. Never set in production. */
  baseUrl?: string
}

const toMinor = (amount: unknown): bigint => {
  // Medusa hands amounts as BigNumber-ish values in MAJOR units.
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0n
  return BigInt(Math.round(n * 100))
}

/**
 * Sifalo is a REDIRECT rail. The buyer leaves for a hosted checkout, pays with
 * EVC Plus / ZAAD / eDahab / Sahal / Premier Wallet or a card, and comes back.
 *
 * So authorization is DEFERRED. Medusa 2.18 models this with
 * "pending_authorization": the cart can complete and the order is created
 * awaiting payment, and this method is called again when the payment lands.
 *
 * Nothing here trusts the browser. The only thing that turns a session into an
 * authorized payment is our own server-to-server call to verify.php returning
 * "success" WITH the amount we asked for.
 */
export class SifaloPaymentProvider extends AbstractPaymentProvider<SifaloOptions> {
  static identifier = "sifalo"

  protected logger_: Logger
  protected options_: SifaloOptions
  protected client_: SifaloClient

  static validateOptions(options: Record<string, unknown>): void {
    for (const required of ["username", "key", "returnUrl"]) {
      if (!String(options?.[required] ?? "").trim()) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Sifalo payment provider: "${required}" is required in medusa-config.ts`
        )
      }
    }
    const url = String(options.returnUrl)
    if (url.includes("localhost") && process.env.NODE_ENV === "production") {
      // The old demo shipped with a localhost return URL. A buyer who pays and
      // is sent to localhost has paid and has no way back to the shop.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Sifalo payment provider: returnUrl must not point at localhost in production"
      )
    }
  }

  constructor(container: { logger: Logger }, options: SifaloOptions) {
    super(container as never, options)
    this.logger_ = container.logger
    this.options_ = options
    this.client_ = new SifaloClient(options)
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const expectedMinor = toMinor(input.amount)
    const currency = String(input.currency_code ?? "USD").toUpperCase()
    const orderRef = String(
      (input.context as Record<string, unknown> | undefined)?.session_id ??
        (input.data as Record<string, unknown> | undefined)?.session_id ??
        `cart-${Date.now()}`
    )

    const session = await this.client_.createSession(expectedMinor, currency, orderRef)
    if (!session.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Sifalo did not open a checkout session: ${session.error}`
      )
    }

    // NOTE: `data` is readable by the storefront, so it carries only what the
    // buyer needs to reach the hosted checkout — never the merchant credentials.
    // expected_amount_minor is carried here so authorization can compare against
    // what we ASKED for rather than whatever comes back.
    return {
      id: orderRef,
      data: {
        sifalo_key: session.key,
        sifalo_token: session.token,
        order_ref: orderRef,
        expected_amount_minor: expectedMinor.toString(),
        currency,
      },
    }
  }

  /**
   * THE GUARD. Called by cart completion, and again later when the payment lands.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const sid = String(data.sid ?? "")
    const expectedMinor = BigInt(String(data.expected_amount_minor ?? "0"))

    // No sid yet means the buyer has not come back from the hosted checkout.
    // That is NOT a failure — it is the normal state of a redirect rail.
    if (!sid) {
      return { status: "pending_authorization" as PaymentSessionStatus, data }
    }

    const v = await this.client_.verify(sid)

    if (v.status === "failure") {
      return { status: PaymentSessionStatus.CANCELED, data: { ...data, sifalo_status: "failure" } }
    }

    // pending, or an unreadable answer, or a network error — all mean "we do not
    // know yet", and none of them may become "paid". A network error especially:
    // it does not mean the customer did not pay.
    if (v.status !== "success") {
      return {
        status: "pending_authorization" as PaymentSessionStatus,
        data: { ...data, sifalo_status: v.status },
      }
    }

    // Success — but only paid if the amount matches what we asked for. Without
    // this a tampered session pays $1 for a $340 order.
    if (!isPaidCorrectly(v, expectedMinor)) {
      this.logger_?.error(
        `[sifalo] AMOUNT MISMATCH on sid ${sid}: asked ${expectedMinor}, Sifalo confirmed ${v.amountMinor}. Not authorizing.`
      )
      return {
        status: "pending_authorization" as PaymentSessionStatus,
        data: {
          ...data,
          sifalo_status: "mismatch",
          verified_amount_minor: v.amountMinor?.toString(),
        },
      }
    }

    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: {
        ...data,
        sifalo_status: "success",
        sifalo_sid: v.sid,
        payment_type: v.paymentType,
        paying_account: v.account,
        verified_amount_minor: v.amountMinor?.toString(),
      },
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const sid = String(data.sid ?? "")
    if (!sid) return { status: "pending" as PaymentSessionStatus, data }
    const v = await this.client_.verify(sid)
    const expectedMinor = BigInt(String(data.expected_amount_minor ?? "0"))
    if (v.status === "failure") return { status: PaymentSessionStatus.CANCELED, data }
    if (isPaidCorrectly(v, expectedMinor)) return { status: PaymentSessionStatus.AUTHORIZED, data }
    return { status: "pending" as PaymentSessionStatus, data }
  }

  /**
   * Sifalo takes the money at the hosted checkout, so there is no separate
   * capture call to make. Capture records that the authorized money is ours.
   */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: { ...(input.data ?? {}), captured_at: new Date().toISOString() } }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return (input.data ?? {}) as RetrievePaymentOutput
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // The amount changed, so the session we opened is for the wrong figure.
    // Re-open rather than silently keeping a stale expected amount.
    return this.initiatePayment(input as unknown as InitiatePaymentInput)
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data ?? {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // Refunds go back through the money layer, not through the collection rail:
    // the 2026-08-24 decision puts money OUT on bank transfer. A refund raised
    // here must be settled by soko-money, so this records intent and refuses to
    // pretend the rail moved anything.
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Sifalo refunds are not automated. Money out is a bank transfer (decision 2026-08-24) — raise the refund in soko-money so it is recorded and paid on the rail that actually sends it."
    )
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    // Sifalo has no documented webhook. Authorization is pull-based: we call
    // verify.php. Declaring "not_supported" is honest; inventing a webhook
    // signature we cannot verify would be worse than having none.
    return { action: "not_supported" } as WebhookActionResult
  }
}

export default SifaloPaymentProvider
export { parseAmount, isPaidCorrectly }
