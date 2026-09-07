import { MedusaError } from "@medusajs/framework/utils"

export const ORDER_LIFECYCLE = [
  "placed",
  "paid",
  "accepted",
  "ready",
  "picked",
  "delivered",
] as const

export type OrderLifecycleState = (typeof ORDER_LIFECYCLE)[number]

export function nextOrderLifecycleState(
  current: OrderLifecycleState,
  requested: unknown
): OrderLifecycleState {
  const currentIndex = ORDER_LIFECYCLE.indexOf(current)
  const expected = ORDER_LIFECYCLE[currentIndex + 1]

  if (requested !== expected) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order in ${current} must transition to ${expected ?? "no further state"}`
    )
  }

  return expected
}
