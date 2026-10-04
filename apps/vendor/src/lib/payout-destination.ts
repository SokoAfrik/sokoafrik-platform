export type BankPayoutDestinationInput = {
  bank_name: string
  bank_account_no: string
  bank_account_name: string
  swift?: string
}

type FetchResponse = {
  ok: boolean
  json(): Promise<unknown>
}

type FetchPayoutDestination = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<FetchResponse>

export async function createBankPayoutDestination(
  input: BankPayoutDestinationInput,
  request: FetchPayoutDestination = fetch,
) {
  const response = await request("/vendor/payout-destination", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const body = await response.json() as {
    message?: string
    payout_destination?: BankPayoutDestinationInput
  }

  if (!response.ok) {
    throw new Error(body.message ?? "Could not save the bank account")
  }

  return body.payout_destination
}
