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
          metadata: { soko_delivery_pin: "4821" },
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
            state === "delivered" ? { state, delivery_pin: "4821" } : { state },
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

      it("terminal_state_is_final_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "order-lifecycle-terminal-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "order-lifecycle-terminal-buyer@sokoafrik.test",
          items: [{ title: "Terminal lifecycle item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Terminal lifecycle delivery", amount: 100 }],
          metadata: { soko_delivery_pin: "9374" },
        })

        for (const state of ["paid", "accepted", "ready", "picked", "delivered"]) {
          await api.post(
            `/admin/orders/${order.id}/lifecycle`,
            state === "delivered" ? { state, delivery_pin: "9374" } : { state },
            adminHeaders
          )
        }

        for (const state of [
          "placed",
          "paid",
          "accepted",
          "ready",
          "picked",
          "delivered",
          "cancelled",
        ]) {
          await expect(
            api.post(
              `/admin/orders/${order.id}/lifecycle`,
              { state },
              adminHeaders
            )
          ).rejects.toMatchObject({ response: { status: 400 } })
        }

        const persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("delivered")
      })

      it("state_change_is_audited_test", async () => {
        const { user } = await createAdminUser(
          dbConnection,
          adminHeaders,
          getContainer(),
          { email: "order-lifecycle-audit-admin@sokoafrik.test" }
        )

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "order-lifecycle-audit-buyer@sokoafrik.test",
          items: [{ title: "Audited lifecycle item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Audited lifecycle delivery", amount: 100 }],
        })

        const before = Date.now()
        await api.post(
          `/admin/orders/${order.id}/lifecycle`,
          { state: "paid" },
          adminHeaders
        )
        await api.post(
          `/admin/orders/${order.id}/lifecycle`,
          { state: "accepted" },
          adminHeaders
        )

        const persisted = await orderService.retrieveOrder(order.id)
        const audit = persisted.metadata?.soko_lifecycle_audit as Array<{
          from: string
          to: string
          actor_id: string
          changed_at: string
        }>

        expect(persisted.metadata?.soko_lifecycle_state).toBe("accepted")
        expect(audit).toHaveLength(2)
        expect(audit.map(({ from, to, actor_id }) => ({ from, to, actor_id })))
          .toEqual([
            { from: "placed", to: "paid", actor_id: user.id },
            { from: "paid", to: "accepted", actor_id: user.id },
          ])
        for (const entry of audit) {
          expect(Date.parse(entry.changed_at)).toBeGreaterThanOrEqual(before)
          expect(Date.parse(entry.changed_at)).toBeLessThanOrEqual(Date.now())
        }
      })

      it("pin_required_before_delivered_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "delivery-pin-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "delivery-pin-buyer@sokoafrik.test",
          items: [{ title: "PIN delivery item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "PIN delivery", amount: 100 }],
          metadata: { soko_delivery_pin: "6142" },
        })

        for (const state of ["paid", "accepted", "ready", "picked"]) {
          await api.post(
            `/admin/orders/${order.id}/lifecycle`,
            { state },
            adminHeaders
          )
        }

        await expect(
          api.post(
            `/admin/orders/${order.id}/lifecycle`,
            { state: "delivered" },
            adminHeaders
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        let persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("picked")

        const delivered = await api.post(
          `/admin/orders/${order.id}/lifecycle`,
          { state: "delivered", delivery_pin: "6142" },
          adminHeaders
        )
        expect(delivered.status).toBe(200)
        expect(delivered.data.state).toBe("delivered")

        persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("delivered")
      })

    })
  },
})
