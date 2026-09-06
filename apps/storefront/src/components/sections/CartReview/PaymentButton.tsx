"use client"

import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import { isManual, isSifalo } from "../../../lib/constants"
import { placeOrder } from "@/lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import React, { useEffect, useState } from "react"
import { Button } from "@/components/atoms"
import { orderErrorFormatter } from "@/lib/helpers/order-error-formatter"
import { toast } from "@/lib/helpers/toast"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
}

const PaymentButton: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
}) => {
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  switch (true) {
    case isSifalo(paymentSession?.provider_id):
      return (
        <SifaloPaymentButton
          notReady={notReady}
          checkoutUrl={String((paymentSession?.data as Record<string, unknown>)?.checkout_url ?? '')}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      return (
        <ManualTestPaymentButton notReady={notReady} data-testid={dataTestId} />
      )
    default:
      return (
        <Button disabled className="w-full">
          Select a payment method
        </Button>
      )
  }
}

/**
 * Sifalo is a REDIRECT rail. This button does not place the order — it sends the
 * buyer to the hosted checkout to pay with EVC Plus, ZAAD, eDahab, Sahal,
 * Premier Wallet or a card. The order is placed when they come back and the
 * SERVER has verified the payment.
 *
 * If the session carries no checkout url, the button refuses rather than
 * pretending: sending someone to nowhere after they have chosen to pay is worse
 * than telling them the payment method is not ready.
 */
const SifaloPaymentButton = ({
  notReady,
  checkoutUrl,
  "data-testid": dataTestId,
}: {
  notReady: boolean
  checkoutUrl: string
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)

  if (!checkoutUrl) {
    return (
      <>
        <Button disabled className="w-full">
          Payment is unavailable
        </Button>
        <ErrorMessage
          error="This payment method did not open a checkout. Please choose another, or try again in a moment."
          data-testid="sifalo-payment-error-message"
        />
      </>
    )
  }

  return (
    <Button
      disabled={notReady}
      loading={submitting}
      className="w-full"
      data-testid={dataTestId}
      onClick={() => {
        setSubmitting(true)
        window.location.href = checkoutUrl
      }}
    >
      Pay with mobile money or card
    </Button>
  )
}

const ManualTestPaymentButton = ({ notReady }: { notReady: boolean }) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    try {
      const res = await placeOrder()
      if (!res.ok) {
        setErrorMessage(res.error?.message)
      }
    } catch (error: any) {
      if (error?.message !== "NEXT_REDIRECT") {
        setErrorMessage(
          error?.message?.replace("Error setting up the request: ", "")
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handlePayment = () => {
    onPaymentCompleted()
  }

  return (
    <>
      <Button
        disabled={notReady}
        onClick={handlePayment}
        className="w-full"
        loading={submitting}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="manual-payment-error-message"
      />
    </>
  )
}

export default PaymentButton
