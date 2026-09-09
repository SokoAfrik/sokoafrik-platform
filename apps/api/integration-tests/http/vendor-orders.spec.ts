import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { IOrderModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"

import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"

jest.setTimeout(120000)

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    describe("Vendor orders", () => {
      it("vendor_sees_only_own_orders_test", async () => {
        const container = getContainer()
        const sellerA = await createSellerUser(container, {
          email: "vendor-orders-a@sokoafrik.test",
          name: "Vendor Orders A",
        })
        const sellerB = await createSellerUser(container, {
          email: "vendor-orders-b@sokoafrik.test",
          name: "Vendor Orders B",
        })

        const orderService =
          container.resolve<IOrderModuleService>(Modules.ORDER)
        const orderA = await orderService.createOrders({
          currency_code: "usd",
          email: "buyer-a@sokoafrik.test",
          items: [{ title: "Vendor A item", quantity: 1, unit_price: 1100 }],
          shipping_methods: [{ name: "Vendor A delivery", amount: 100 }],
        })
        const orderB = await orderService.createOrders({
          currency_code: "usd",
          email: "buyer-b@sokoafrik.test",
          items: [{ title: "Vendor B item", quantity: 1, unit_price: 2200 }],
          shipping_methods: [{ name: "Vendor B delivery", amount: 100 }],
        })

        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create([
          {
            [Modules.ORDER]: { order_id: orderA.id },
            [MercurModules.SELLER]: { seller_id: sellerA.seller.id },
          },
          {
            [Modules.ORDER]: { order_id: orderB.id },
            [MercurModules.SELLER]: { seller_id: sellerB.seller.id },
          },
        ])

        const responseA = await api.get(
          "/vendor/orders?fields=id&limit=100",
          sellerA.headers
        )
        const responseB = await api.get(
          "/vendor/orders?fields=id&limit=100",
          sellerB.headers
        )

        expect(responseA.status).toBe(200)
        expect(responseB.status).toBe(200)
        expect(responseA.data.orders.map((order: { id: string }) => order.id))
          .toEqual([orderA.id])
        expect(responseB.data.orders.map((order: { id: string }) => order.id))
          .toEqual([orderB.id])
      })
    })
  },
})
