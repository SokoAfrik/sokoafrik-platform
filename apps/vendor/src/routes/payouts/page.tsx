import { useState, type FormEvent } from "react"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { Button, Container, Heading, Input, Label, Text } from "@medusajs/ui"
import {
  createBankPayoutDestination,
  createVendorWithdrawal,
} from "../../lib/payout-destination"

export const config: RouteConfig = {
  label: "Payouts",
  rank: 1,
}

export function BankPayoutDestinationForm() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("saving")
    setError(null)

    const fields = new FormData(event.currentTarget)
    try {
      await createBankPayoutDestination({
        bank_name: String(fields.get("bank_name") ?? ""),
        bank_account_no: String(fields.get("bank_account_no") ?? ""),
        bank_account_name: String(fields.get("bank_account_name") ?? ""),
        swift: String(fields.get("swift") ?? "") || undefined,
      })
      setStatus("saved")
    } catch (cause) {
      setStatus("idle")
      setError(cause instanceof Error ? cause.message : "Could not save the bank account")
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="bank_name">Bank name</Label>
        <Input id="bank_name" name="bank_name" required autoComplete="organization" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bank_account_no">Account number</Label>
        <Input id="bank_account_no" name="bank_account_no" required autoComplete="off" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bank_account_name">Account holder name</Label>
        <Input id="bank_account_name" name="bank_account_name" required autoComplete="name" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="swift">SWIFT code (optional)</Label>
        <Input id="swift" name="swift" autoComplete="off" />
      </div>

      {error ? <Text className="text-ui-fg-error">{error}</Text> : null}
      {status === "saved" ? (
        <Text className="text-ui-fg-success">Bank account saved. Verification is the next step.</Text>
      ) : null}

      <Button type="submit" isLoading={status === "saving"}>
        Save bank account
      </Button>
    </form>
  )
}

export function WithdrawalRequestForm() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("saving")
    setError(null)

    const fields = new FormData(event.currentTarget)
    try {
      await createVendorWithdrawal({
        amount_minor: Number(fields.get("amount_minor")),
        currency: String(fields.get("currency") ?? ""),
      })
      setStatus("saved")
    } catch (cause) {
      setStatus("idle")
      setError(cause instanceof Error ? cause.message : "Could not request the withdrawal")
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="amount_minor">Amount in minor units</Label>
        <Input
          id="amount_minor"
          name="amount_minor"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="currency">Currency</Label>
        <Input id="currency" name="currency" defaultValue="USD" maxLength={3} required />
      </div>

      {error ? <Text className="text-ui-fg-error">{error}</Text> : null}
      {status === "saved" ? (
        <Text className="text-ui-fg-success">Withdrawal requested for manual bank payout.</Text>
      ) : null}

      <Button type="submit" isLoading={status === "saving"}>
        Request withdrawal
      </Button>
    </form>
  )
}

export default function PayoutsPage() {
  return (
    <Container className="p-0">
      <div className="border-b px-6 py-4">
        <Heading>Payouts</Heading>
        <Text className="mt-1 text-ui-fg-subtle" size="small">
          Add the bank account where SokoAfrik should send your payouts.
        </Text>
      </div>
      <div className="grid max-w-xl gap-8 px-6 py-6">
        <section className="grid gap-4">
          <Heading level="h2">Bank account</Heading>
          <BankPayoutDestinationForm />
        </section>
        <section className="grid gap-4 border-t pt-6">
          <Heading level="h2">Withdraw funds</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Requests are paid manually to your verified bank account.
          </Text>
          <WithdrawalRequestForm />
        </section>
      </div>
    </Container>
  )
}
