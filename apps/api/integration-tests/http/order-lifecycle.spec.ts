import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  adminHeaders,
  createAdminUser,
} from "../../../../integration-tests/helpers/create-admin-user"

jest.setTimeout(120000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, dbConnection, getContainer }) => {
    describe("Order lifecycle", () => {
      it("every_legal_transition_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "order-lifecycle-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "order-lifecycle-buyer@sokoafrik.test",
          items: [{ title: "Lifecycle item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Lifecycle delivery", amount: 100 }],
        })

        for (const state of [
          "paid",
          "accepted",
          "ready",
          "picked",
          "delivered",
        ]) {
          const response = await api.post(
            `/admin/orders/${order.id}/lifecycle`,
            { state },
            adminHeaders
          )

          expect(response.status).toBe(200)
          expect(response.data.state).toBe(state)
          expect(response.data.order.metadata.soko_lifecycle_state).toBe(state)
        }

        const persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("delivered")
      })

      it("illegal_transition_refused_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "order-lifecycle-refusal-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "order-lifecycle-refusal-buyer@sokoafrik.test",
          items: [{ title: "Lifecycle refusal item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Lifecycle refusal delivery", amount: 100 }],
        })

        for (const state of ["placed", "accepted", "cancelled"]) {
          await expect(
            api.post(
              `/admin/orders/${order.id}/lifecycle`,
              { state },
              adminHeaders
            )
          ).rejects.toMatchObject({ response: { status: 400 } })
        }

        let persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBeUndefined()

        const paid = await api.post(
          `/admin/orders/${order.id}/lifecycle`,
          { state: "paid" },
          adminHeaders
        )
        expect(paid.status).toBe(200)

        for (const state of ["placed", "paid", "ready", "cancelled"]) {
          await expect(
            api.post(
              `/admin/orders/${order.id}/lifecycle`,
              { state },
              adminHeaders
            )
          ).rejects.toMatchObject({ response: { status: 400 } })
        }

        persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("paid")
      })

    })
  },
})
