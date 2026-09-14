import { createElement, type ReactNode } from "react"

import { ENGLISH_CATALOGUE } from "../../../content/english-catalogue"

export const EscrowBuyboxAction = ({ children }: { children: ReactNode }) =>
  createElement(
    "div",
    { "data-testid": "escrow-buybox-action" },
    createElement(
      "p",
      {
        className: "label-md text-secondary mb-3",
        "data-testid": "escrow-protection-line",
      },
      ENGLISH_CATALOGUE.product.escrowProtection
    ),
    children
  )
