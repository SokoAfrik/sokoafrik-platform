import http from "node:http"
import type { AddressInfo } from "node:net"

/**
 * A stand-in for Sifalo's gateway.
 *
 * D-0070 binds the build: no test may depend on a live Sifalo account, live
 * operator credentials, or a Somali company existing. So the rail is proven
 * against the interface. This stub speaks the two calls the real gateway
 * speaks and nothing else, and every behaviour it can produce is one the real
 * gateway is documented (by our own working integration) to produce.
 *
 * It exists to answer one question a live account could not answer safely:
 * what does our provider do when the gateway says the customer paid a
 * DIFFERENT amount than we asked for.
 */
export type StubBehaviour =
  | { kind: "success"; amount: string }
  | { kind: "pending" }
  | { kind: "failure" }
  | { kind: "garbage" }        // a body we cannot read as any known status
  | { kind: "no_session" }     // the gateway refuses to open a checkout

export interface SifaloStub {
  url: string
  close: () => Promise<void>
  setBehaviour: (b: StubBehaviour) => void
  calls: { path: string; body: unknown }[]
}

export async function startSifaloStub(initial: StubBehaviour): Promise<SifaloStub> {
  let behaviour = initial
  const calls: { path: string; body: unknown }[] = []

  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      let body: unknown = {}
      try { body = JSON.parse(raw || "{}") } catch { body = { unparseable: raw } }
      calls.push({ path: req.url ?? "", body })
      const json = (o: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(o))
      }
      if (req.url?.startsWith("/gateway/verify.php")) {
        switch (behaviour.kind) {
          case "success": return json({ sid: "sid_test", account: "615000000", payment_type: "EDAHAB", amount: behaviour.amount, status: "success", code: 200 })
          case "pending": return json({ sid: "sid_test", status: "pending", code: 102 })
          case "failure": return json({ sid: "sid_test", status: "failure", code: 400 })
          default:        return json({ nothing: "we recognise" })
        }
      }
      if (req.url?.startsWith("/gateway")) {
        if (behaviour.kind === "no_session") return json({ error: "declined" })
        return json({ key: "key_test", token: "token_test" })
      }
      res.writeHead(404); res.end()
    })
  })

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
    setBehaviour: (b) => { behaviour = b },
    calls,
  }
}
