import { test, expect } from "@playwright/test"
import { startSifaloStub } from "./sifalo-stub"
import { SifaloPaymentProvider } from "@mercurjs/core/providers/sifalo"

// THE COLLECTION RAIL, DRIVEN AGAINST THE PRODUCTION PROVIDER CLASS.
//
// Decision 2026-08-24: money in is Sifalo Pay. Decision D-0070: nothing may
// depend on a live Sifalo account, so this proves the rail against the
// interface — which is also the only way to test the case that matters most,
// because you cannot ask a real gateway to confirm the wrong amount.
//
// THE RULE UNDER TEST: an order is paid when OUR SERVER has called verify.php
// and seen "success" AND the amount matches what we asked for. Nothing else.

const logger = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} } as never
const provider = (baseUrl: string) =>
  new SifaloPaymentProvider({ logger } as never, {
    username: "u", key: "k", returnUrl: "https://sokoafrik.test/return", baseUrl,
  })

test("a checkout session is opened and carries the amount we asked for", async () => {
  const stub = await startSifaloStub({ kind: "success", amount: "13.30" })
  try {
    const p = provider(stub.url)
    const out = await p.initiatePayment({ amount: 13.3, currency_code: "usd", context: { session_id: "ref-1" } } as never)
    expect(out.data?.sifalo_key, "the buyer needs the hosted checkout handles").toBe("key_test")
    expect(out.data?.expected_amount_minor, "what we asked for must be carried, not recomputed later").toBe("1330")
    const asked = JSON.parse(JSON.stringify(stub.calls.find(c => c.path.startsWith("/gateway") && !c.path.includes("verify"))!.body))
    expect(asked.amount, "the gateway must be asked for the real amount, not the demo's hardcoded 1").toBe("13.30")
    expect(String(asked.return_url), "our reference has to survive the round trip").toContain("ref-1")
  } finally { await stub.close() }
})

test("the buyer is given somewhere to go — the checkout url, not just a token", async () => {
  const stub = await startSifaloStub({ kind: "success", amount: "13.30" })
  try {
    const out = await provider(stub.url).initiatePayment({ amount: 13.3, currency_code: "usd", context: { session_id: "ref-2" } } as never)
    const url = String(out.data?.checkout_url)
    // The shape is not invented — it is SokoAfrik's own working integration:
    // https://pay.sifalo.com/checkout/?key=<key>&token=<token>
    expect(url).toContain("pay.sifalo.com/checkout/")
    expect(url).toContain("key=key_test")
    expect(url).toContain("token=token_test")
  } finally { await stub.close() }
})

test("a gateway that will not open a session fails loudly, it does not return a broken session", async () => {
  const stub = await startSifaloStub({ kind: "no_session" })
  try {
    await expect(provider(stub.url).initiatePayment({ amount: 10, currency_code: "usd", context: {} } as never))
      .rejects.toThrow(/did not open a checkout session/i)
  } finally { await stub.close() }
})

test("before the buyer returns there is no sid, and that is pending — never paid", async () => {
  const stub = await startSifaloStub({ kind: "pending" })
  try {
    const out = await provider(stub.url).authorizePayment({ data: { expected_amount_minor: "1330" } } as never)
    expect(out.status).toBe("pending_authorization")
  } finally { await stub.close() }
})

test("success at the right amount is the only thing that authorises", async () => {
  const stub = await startSifaloStub({ kind: "success", amount: "13.30" })
  try {
    const out = await provider(stub.url).authorizePayment({ data: { sid: "sid_test", expected_amount_minor: "1330" } } as never)
    expect(out.status).toBe("authorized")
    expect(out.data?.payment_type, "the rail the buyer actually used is recorded").toBe("EDAHAB")
    expect(out.data?.verified_amount_minor).toBe("1330")
  } finally { await stub.close() }
})

test("SUCCESS AT THE WRONG AMOUNT IS NOT PAID — this is the defect the old demo shipped", async () => {
  // The gateway says the customer paid. It says they paid $1. The order is $13.30.
  // Without this check a tampered session buys a $340 order for a dollar.
  const stub = await startSifaloStub({ kind: "success", amount: "1.00" })
  try {
    const out = await provider(stub.url).authorizePayment({ data: { sid: "sid_test", expected_amount_minor: "1330" } } as never)
    expect(out.status, "a mismatched amount must never authorise").not.toBe("authorized")
    expect(out.data?.sifalo_status).toBe("mismatch")
    expect(out.data?.verified_amount_minor, "and the figure that came back is kept, so it can be investigated").toBe("100")
  } finally { await stub.close() }
})

test("an explicit failure cancels", async () => {
  const stub = await startSifaloStub({ kind: "failure" })
  try {
    const out = await provider(stub.url).authorizePayment({ data: { sid: "sid_test", expected_amount_minor: "1330" } } as never)
    expect(out.status).toBe("canceled")
  } finally { await stub.close() }
})

test("an answer we cannot read is UNKNOWN, and unknown is not paid and not failed", async () => {
  const stub = await startSifaloStub({ kind: "garbage" })
  try {
    const out = await provider(stub.url).authorizePayment({ data: { sid: "sid_test", expected_amount_minor: "1330" } } as never)
    expect(out.status).toBe("pending_authorization")
    expect(out.data?.sifalo_status).toBe("unknown")
  } finally { await stub.close() }
})

test("a gateway we cannot reach does not cancel the order — the customer may well have paid", async () => {
  // Deliberately point at a closed port. A network error must never be read as
  // "the customer did not pay": that would cancel an order somebody has paid for.
  const p = provider("http://127.0.0.1:1")
  const out = await p.authorizePayment({ data: { sid: "sid_test", expected_amount_minor: "1330" } } as never)
  expect(out.status).toBe("pending_authorization")
  expect(out.data?.sifalo_status).toBe("unknown")
})

test("a refund is refused here, because money out is a bank transfer", async () => {
  const stub = await startSifaloStub({ kind: "success", amount: "13.30" })
  try {
    await expect(provider(stub.url).refundPayment({ data: {}, amount: 1 } as never))
      .rejects.toThrow(/bank transfer/i)
  } finally { await stub.close() }
})

test("the provider refuses to start without the credentials it needs", async () => {
  expect(() => SifaloPaymentProvider.validateOptions({ username: "u", key: "" } as never)).toThrow(/key/i)
  expect(() => SifaloPaymentProvider.validateOptions({ username: "u", key: "k", returnUrl: "https://x/y" } as never)).not.toThrow()
})
