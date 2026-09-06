/**
 * Sifalo Pay — the collection rail.
 *
 * SOURCE OF THIS SHAPE. Not documentation — Sifalo's developer portal is not
 * publicly readable. This mirrors SokoAfrik's OWN working integration, carried
 * over from soko-money/src/providers/sifalo.ts, which was itself read out of
 * soko-web-customer-Vendor/payment/sifaloPay.cjs.
 *
 *   POST {base}/gateway/            Authorization: Basic base64(user:key)
 *     { amount, gateway: "checkout", currency, return_url }  ->  { key, token }
 *
 *   POST {base}/gateway/verify.php
 *     { sid }  ->  { sid, account, payment_type, amount, status, code }
 *                  status: "success" | "pending" | "failure"
 *
 * Coverage: EVC Plus, ZAAD, eDahab, Sahal, Premier Wallet, Visa/Mastercard/Amex.
 *
 * THE RULE THAT MATTERS, and it is the whole reason this file exists:
 *   An order is paid when OUR SERVER has called verify.php and seen "success"
 *   AND the amount matches what we asked for. Never because the browser came
 *   back to the return URL — the customer controls that URL, they do not control
 *   our server-to-server call.
 */

export type SifaloStatus = "success" | "pending" | "failure" | "unknown"

export interface SifaloConfig {
  username: string
  key: string
  returnUrl: string
  baseUrl?: string
}

export interface SifaloSession {
  ok: boolean
  key?: string
  token?: string
  error?: string
}

export interface SifaloVerification {
  status: SifaloStatus
  sid?: string
  account?: string
  paymentType?: string
  amountMinor?: bigint
  code?: number
  raw: unknown
}

export function parseAmount(v: unknown): bigint | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).replace(/[,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined
  const [i, f = ""] = s.split(".")
  return BigInt(i) * 100n + BigInt(f.padEnd(2, "0"))
}

/**
 * The check the old demo did not do. Without it a tampered session could pay
 * $1 for a $340 order and the order would read as paid.
 */
export function isPaidCorrectly(v: SifaloVerification, expectedMinor: bigint): boolean {
  return v.status === "success" && v.amountMinor === expectedMinor
}

export class SifaloClient {
  constructor(private cfg: SifaloConfig) {}
  private get base() {
    return this.cfg.baseUrl ?? "https://api.sifalopay.com"
  }
  private get auth() {
    return "Basic " + Buffer.from(`${this.cfg.username}:${this.cfg.key}`).toString("base64")
  }

  async createSession(
    amountMinor: bigint,
    currency: string,
    orderRef: string
  ): Promise<SifaloSession> {
    const amount = `${amountMinor / 100n}.${String(amountMinor % 100n).padStart(2, "0")}`
    try {
      const res = await fetch(`${this.base}/gateway/`, {
        method: "POST",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          gateway: "checkout",
          currency,
          return_url: `${this.cfg.returnUrl}?ref=${encodeURIComponent(orderRef)}`,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const body = (await res.json()) as { key?: string; token?: string }
      if (!body?.key || !body?.token) {
        return { ok: false, error: "gateway returned no key/token" }
      }
      return { ok: true, key: body.key, token: body.token }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  async verify(sid: string): Promise<SifaloVerification> {
    try {
      const res = await fetch(`${this.base}/gateway/verify.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid }),
        signal: AbortSignal.timeout(30_000),
      })
      const raw = (await res.json()) as Record<string, unknown>
      const status = String(raw?.status ?? "").toLowerCase()
      return {
        status:
          status === "success" ? "success"
          : status === "pending" ? "pending"
          : status === "failure" ? "failure"
          : "unknown",
        sid: raw?.sid as string | undefined,
        account: raw?.account as string | undefined,
        paymentType: raw?.payment_type as string | undefined,
        amountMinor: parseAmount(raw?.amount),
        code: typeof raw?.code === "number" ? (raw.code as number) : undefined,
        raw,
      }
    } catch (e) {
      // UNKNOWN, NOT FAILED. A network error does not mean the customer did not
      // pay. Treating it as failure would cancel an order somebody has paid for.
      return { status: "unknown", raw: { error: String(e) } }
    }
  }
}
