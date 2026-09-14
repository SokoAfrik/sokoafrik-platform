import React from "react"

import { Button } from "../../atoms/Button/Button"
import { EscrowBuyboxAction } from "../../molecules/EscrowBuyboxAction/EscrowBuyboxAction"

export const ProductDetailsBuyboxAction = ({
  disabled,
  label,
  loading,
  onClick,
}: {
  disabled: boolean
  label: string
  loading: boolean
  onClick: () => void
}) => (
  <EscrowBuyboxAction>
    <Button
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      className="w-full uppercase mb-4 py-3 flex justify-center"
      size="large"
      data-testid="product-add-to-cart-button"
    >
      {label}
    </Button>
  </EscrowBuyboxAction>
)
