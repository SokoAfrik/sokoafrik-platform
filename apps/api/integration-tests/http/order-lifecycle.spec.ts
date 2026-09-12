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
            state === "delivered"
              ? { state, delivery_pin: "4821", delivery_photo: "photo://legal-transition" }
              : { state },
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
            state === "delivered"
              ? { state, delivery_pin: "9374", delivery_photo: "photo://terminal-state" }
              : { state },
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
          {
            state: "delivered",
            delivery_pin: "6142",
            delivery_photo: "photo://pin-required",
          },
          adminHeaders
        )
        expect(delivered.status).toBe(200)
        expect(delivered.data.state).toBe("delivered")

        persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("delivered")
      })

      it("wrong_pin_refused_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "wrong-delivery-pin-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "wrong-delivery-pin-buyer@sokoafrik.test",
          items: [{ title: "Wrong PIN delivery item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Wrong PIN delivery", amount: 100 }],
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
            { state: "delivered", delivery_pin: "6143" },
            adminHeaders
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        let persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("picked")

        const delivered = await api.post(
          `/admin/orders/${order.id}/lifecycle`,
          {
            state: "delivered",
            delivery_pin: "6142",
            delivery_photo: "photo://wrong-pin",
          },
          adminHeaders
        )
        expect(delivered.status).toBe(200)
        expect(delivered.data.state).toBe("delivered")

        persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("delivered")
      })

      it("photo_required_before_delivered_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "delivery-photo-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "delivery-photo-buyer@sokoafrik.test",
          items: [{ title: "Photo delivery item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Photo delivery", amount: 100 }],
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
            { state: "delivered", delivery_pin: "6142" },
            adminHeaders
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        let persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("picked")
        expect(persisted.metadata?.soko_delivery_photo).toBeUndefined()

        const delivered = await api.post(
          `/admin/orders/${order.id}/lifecycle`,
          {
            state: "delivered",
            delivery_pin: "6142",
            delivery_photo: "photo://delivery-proof-1",
          },
          adminHeaders
        )
        expect(delivered.status).toBe(200)
        expect(delivered.data.state).toBe("delivered")

        persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("delivered")
        expect(persisted.metadata?.soko_delivery_photo)
          .toBe("photo://delivery-proof-1")
      })

      it("missing delivery photo is refused before a delivery audit is written", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "missing-photo-audit-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "missing-photo-audit-buyer@sokoafrik.test",
          items: [{ title: "Missing photo audit item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Missing photo audit delivery", amount: 100 }],
          metadata: { soko_delivery_pin: "6142" },
        })

        for (const state of ["paid", "accepted", "ready", "picked"]) {
          await api.post(
            `/admin/orders/${order.id}/lifecycle`,
            { state },
            adminHeaders
          )
        }

        const before = await orderService.retrieveOrder(order.id)
        const auditBefore = before.metadata?.soko_lifecycle_audit
        expect(Array.isArray(auditBefore)).toBe(true)

        await expect(
          api.post(
            `/admin/orders/${order.id}/lifecycle`,
            { state: "delivered", delivery_pin: "6142" },
            adminHeaders
          )
        ).rejects.toMatchObject({
          response: {
            status: 400,
            data: {
              message: "A delivery photo is required before delivery can be confirmed",
            },
          },
        })

        const after = await orderService.retrieveOrder(order.id)
        expect(after.metadata?.soko_lifecycle_state).toBe("picked")
        expect(after.metadata?.soko_delivery_photo).toBeUndefined()
        expect(after.metadata?.soko_lifecycle_audit).toEqual(auditBefore)
      })

      it("blank_delivery_photo_refused_test", async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer(), {
          email: "blank-delivery-photo-admin@sokoafrik.test",
        })

        const orderService =
          getContainer().resolve<IOrderModuleService>(Modules.ORDER)
        const order = await orderService.createOrders({
          currency_code: "usd",
          email: "blank-delivery-photo-buyer@sokoafrik.test",
          items: [{ title: "Blank photo delivery item", quantity: 1, unit_price: 1000 }],
          shipping_methods: [{ name: "Blank photo delivery", amount: 100 }],
          metadata: { soko_delivery_pin: "6142" },
        })

        for (const state of ["paid", "accepted", "ready", "picked"]) {
          await api.post(
            `/admin/orders/${order.id}/lifecycle`,
            { state },
            adminHeaders
          )
        }

        for (const delivery_photo of ["", "   \n\t"]) {
          await expect(
            api.post(
              `/admin/orders/${order.id}/lifecycle`,
              { state: "delivered", delivery_pin: "6142", delivery_photo },
              adminHeaders
            )
          ).rejects.toMatchObject({ response: { status: 400 } })
        }

        const persisted = await orderService.retrieveOrder(order.id)
        expect(persisted.metadata?.soko_lifecycle_state).toBe("picked")
        expect(persisted.metadata?.soko_delivery_photo).toBeUndefined()
      })

    })
  },
})
