import React from "react"
import { Cash, CreditCard } from "@medusajs/icons"

export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  // Sifalo Pay — the collection rail (decision 2026-08-24). One integration
  // covering EVC Plus, ZAAD, eDahab, Sahal, Premier Wallet and Visa/Mastercard/
  // Amex, as a hosted checkout the buyer is redirected to.
  pp_sifalo_sifalo: {
    title: "Mobile money or card",
    icon: <CreditCard />,
  },
  // Medusa's no-op provider. Test and development only — it moves no money.
  pp_system_default: {
    title: "Manual Payment",
    icon: <Cash />,
  },
}

// Stripe and PayPal entries removed 2026-09-06 along with the Stripe SDK.
// Neither rail is usable in Somalia and neither was ever going to be used;
// they were stock Mercur furniture that loaded a third party into every
// buyer's checkout.
export const isSifalo = (providerId?: string) => {
  return providerId?.startsWith("pp_sifalo")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]

export const PROTECTED_ROUTES = ['/user', '/user/orders', '/user/settings', '/user/addresses', '/user/messages', '/user/returns']