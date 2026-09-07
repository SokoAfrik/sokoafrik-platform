import type { IOrderModuleService } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  nextOrderLifecycleState,
  ORDER_LIFECYCLE,
  type OrderLifecycleState,
} from "../../../../../lib/order-lifecycle"

type LifecycleBody = {
  state?: unknown
}

export async function POST(
  req: MedusaRequest<LifecycleBody>,
  res: MedusaResponse
) {
  const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
  const order = await orderService.retrieveOrder(req.params.id)
  const stored = order.metadata?.soko_lifecycle_state
  const current =
    typeof stored === "string" && ORDER_LIFECYCLE.includes(stored as OrderLifecycleState)
      ? (stored as OrderLifecycleState)
      : "placed"

  if (stored !== undefined && current === "placed" && stored !== "placed") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order has an invalid lifecycle state"
    )
  }

  const state = nextOrderLifecycleState(current, req.body?.state)
  await orderService.updateOrders(order.id, {
    metadata: {
      ...(order.metadata ?? {}),
      soko_lifecycle_state: state,
    },
  })
  const updated = await orderService.retrieveOrder(order.id)

  res.status(200).json({ order: updated, state })
}
