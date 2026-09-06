"use client"

import React from "react"
import { HttpTypes } from "@medusajs/types"

// Stripe removed 2026-09-06. SokoAfrik collects through Sifalo Pay (decision
// 2026-08-24) — EVC Plus, ZAAD, eDahab, Sahal, Premier Wallet and cards behind
// one hosted checkout. Stripe was stock Mercur furniture for a rail this
// business ruled out, and it loaded Stripe's SDK into every buyer's browser and
// called m.stripe.com on every checkout. Sifalo is a redirect flow: there is no
// card element to mount, so this wrapper has nothing to wrap.
type PaymentWrapperProps = {
  cart: HttpTypes.StoreCart
  children: React.ReactNode
}

const PaymentWrapper: React.FC<PaymentWrapperProps> = ({ children }) => {
  return <div>{children}</div>
}

export default PaymentWrapper
