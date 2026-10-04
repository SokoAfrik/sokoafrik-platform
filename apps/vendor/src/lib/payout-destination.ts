export type BankPayoutDestinationInput = {
  bank_name: string
  bank_account_no: string
  bank_account_name: string
  swift?: string
}

export type VendorWithdrawalInput = {
  amount_minor: number
  currency: string
}

export type VendorWithdrawal = VendorWithdrawalInput & {
  id: string
  status: "requested"
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

export async function createVendorWithdrawal(
  input: VendorWithdrawalInput,
  request: FetchPayoutDestination = fetch,
): Promise<VendorWithdrawal | undefined> {
  const response = await request("/vendor/withdrawals", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const body = await response.json() as {
    message?: string
    withdrawal?: VendorWithdrawal
  }

  if (!response.ok) {
    throw new Error(body.message ?? "Could not request the withdrawal")
  }

  return body.withdrawal
}
