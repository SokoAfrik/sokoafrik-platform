import { randomInt } from "node:crypto"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

type DispatchBody = {
  courier_id?: unknown
}

type DispatchAuditEntry = {
  courier_id: string
  assigned_by: string
  assigned_at: string
}

export async function POST(
  req: MedusaRequest<DispatchBody>,
  res: MedusaResponse
): Promise<void> {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Dispatch assignment requires an authenticated actor"
    )
  }

  const courierId = req.body?.courier_id
  if (typeof courierId !== "string" || courierId.trim() === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A courier_id is required for dispatch assignment"
    )
  }

  const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
  const order = await orderService.retrieveOrder(req.params.id)
  const deliveryPin = String(randomInt(0, 10_000)).padStart(4, "0")
  const storedAudit = order.metadata?.soko_dispatch_audit
  const audit = Array.isArray(storedAudit)
    ? (storedAudit as DispatchAuditEntry[])
    : []

  await orderService.updateOrders(order.id, {
    metadata: {
      ...(order.metadata ?? {}),
      soko_courier_id: courierId,
      soko_delivery_pin: deliveryPin,
      soko_dispatch_audit: [
        ...audit,
        {
          courier_id: courierId,
          assigned_by: actorId,
          assigned_at: new Date().toISOString(),
        },
      ],
    },
  })

  const updated = await orderService.retrieveOrder(order.id)
  res.status(200).json({ order: updated, delivery_pin: deliveryPin })
}
