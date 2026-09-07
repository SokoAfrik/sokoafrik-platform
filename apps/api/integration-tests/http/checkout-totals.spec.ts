import { readFileSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  IRegionModuleService,
  ISalesChannelModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../integration-tests/helpers/create-admin-user"
import { createVendorProduct } from "../../../../integration-tests/helpers/create-product"
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"
import { MercurModules, SellerStatus } from "@mercurjs/types"
import { sweepPaidSifaloSessions } from "../../src/jobs/sweep-sifalo-payments"

jest.setTimeout(420 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    MEDUSA_FF_PRODUCT_REQUEST: "false",
    SIFALO_USERNAME: "integration-user",
    SIFALO_KEY: "integration-key",
    SIFALO_RETURN_URL: "http://store.test/checkout/sifalo-return",
    SIFALO_BASE_URL: "http://sifalo.test",
    SIFALO_CHECKOUT_BASE_URL: "http://sifalo.test/checkout/",
  },
  testSuite: ({ api, getContainer, dbConnection }) => {
    describe("Checkout totals", () => {
      const createPricedCart = async (
        fixture: string,
        paymentProviderId = "pp_system_default"
      ) => {
        const container: MedusaContainer = getContainer()
        const seller = await createSellerUser(container, {
          email: `${fixture}@sokoafrik.test`,
          name: `${fixture} Seller`,
        })

        const salesChannelModule =
          container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
        const salesChannel = await salesChannelModule.createSalesChannels({
          name: `${fixture} Channel`,
        })

        const regionModule =
          container.resolve<IRegionModuleService>(Modules.REGION)
        const region = await regionModule.createRegions({
          name: `${fixture} Region`,
          currency_code: "usd",
          countries: ["us"],
        })

        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create({
          [Modules.REGION]: { region_id: region.id },
          [Modules.PAYMENT]: { payment_provider_id: paymentProviderId },
        })

        const stockLocation = (
          await api.post(
            "/vendor/stock-locations",
            { name: `${fixture} Warehouse` },
            seller.headers
          )
        ).data.stock_location
        await api.post(
          `/vendor/stock-locations/${stockLocation.id}/sales-channels`,
          { add: [salesChannel.id] },
          seller.headers
        )

        const product = await createVendorProduct(api, seller.headers, {
          title: `${fixture} product`,
          sku: `${fixture}-VARIANT`,
        })
        await api.post(
          `/vendor/sales-channels/${salesChannel.id}/products`,
          { add: [product.id] },
          seller.headers
        )

        const shippingProfile = (
          await api.post(
            "/vendor/shipping-profiles",
            { name: `${fixture} Profile`, type: "default" },
            seller.headers
          )
        ).data.shipping_profile
        const offer = (
          await api.post(
            "/vendor/offers",
            {
              sku: `${fixture}-OFFER`,
              variant_id: product.variants[0].id,
              shipping_profile_id: shippingProfile.id,
              inventory_items: [
                {
                  title: `${fixture} Inventory`,
                  required_quantity: 1,
                  stock_levels: [
                    {
                      location_id: stockLocation.id,
                      stocked_quantity: 10,
                    },
                  ],
                },
              ],
              prices: [{ amount: 4200, currency_code: "usd" }],
            },
            seller.headers
          )
        ).data.offer

        const publishableKey = await generatePublishableKey(container)
        const storeHeaders = generateStoreHeaders({ publishableKey })
        const cart = (
          await api.post(
            "/store/carts",
            {
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              currency_code: "usd",
            },
            storeHeaders
          )
        ).data.cart

        return {
          cart,
          offer,
          region,
          salesChannel,
          seller,
          shippingProfile,
          stockLocation,
          storeHeaders,
        }
      }

      it("computes the cart total from the persisted offer price", async () => {
        const { cart, offer, storeHeaders } = await createPricedCart(
          "SERVER-TOTAL"
        )

        const response = await api.post(
          `/store/carts/${cart.id}/line-items`,
          { offer_id: offer.id, quantity: 2 },
          storeHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.cart.items).toHaveLength(1)
        expect(response.data.cart.items[0]).toMatchObject({
          unit_price: 4200,
          quantity: 2,
        })
        expect(response.data.cart).toMatchObject({
          subtotal: 8400,
          total: 8400,
        })
      })

      it("totals_computed_server_side_test", async () => {
        const { cart, offer, storeHeaders } = await createPricedCart(
          "SERVER-AUTHORITY"
        )

        await expect(
          api.post(
            `/store/carts/${cart.id}/line-items`,
            {
              offer_id: offer.id,
              quantity: 2,
              unit_price: 1,
            },
            storeHeaders
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        await api.post(
          `/store/carts/${cart.id}/line-items`,
          { offer_id: offer.id, quantity: 2 },
          storeHeaders
        )

        const persisted = await api.get(
          `/store/carts/${cart.id}`,
          storeHeaders
        )
        expect(persisted.data.cart.items).toHaveLength(1)
        expect(persisted.data.cart.items[0]).toMatchObject({
          unit_price: 4200,
          quantity: 2,
        })
        expect(persisted.data.cart).toMatchObject({
          subtotal: 8400,
          total: 8400,
        })
      })

      it("refuses a client-supplied line-item price", async () => {
        const { cart, offer, storeHeaders } = await createPricedCart(
          "CLIENT-TOTAL"
        )

        await expect(
          api.post(
            `/store/carts/${cart.id}/line-items`,
            { offer_id: offer.id, quantity: 2, unit_price: 1 },
            storeHeaders
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        const persisted = await api.get(
          `/store/carts/${cart.id}`,
          storeHeaders
        )
        expect(persisted.data.cart.items).toHaveLength(0)
        expect(persisted.data.cart).toMatchObject({
          subtotal: 0,
          total: 0,
        })
      })

      it("a checkout with a tampered client total persists the server-computed total", async () => {
        const { cart, offer, storeHeaders } = await createPricedCart(
          "TAMPERED-TOTAL"
        )

        const pricedByServer = await api.post(
          `/store/carts/${cart.id}/line-items`,
          { offer_id: offer.id, quantity: 2 },
          storeHeaders
        )
        expect(pricedByServer.data.cart).toMatchObject({
          subtotal: 8400,
          total: 8400,
        })

        await expect(
          api.post(
            `/store/carts/${cart.id}/line-items`,
            { offer_id: offer.id, quantity: 2, unit_price: 1 },
            storeHeaders
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        const persisted = await api.get(
          `/store/carts/${cart.id}`,
          storeHeaders
        )
        expect(persisted.data.cart.items).toHaveLength(1)
        expect(persisted.data.cart.items[0]).toMatchObject({
          unit_price: 4200,
          quantity: 2,
        })
        expect(persisted.data.cart).toMatchObject({
          subtotal: 8400,
          total: 8400,
        })
      })

      it("paid_but_unreturned_session_is_swept_and_completed_test", async () => {
        for (const migration of ["001_ledger.sql", "016_escrow_accounts.sql"]) {
          await dbConnection.raw(
            readFileSync(
              path.resolve(process.cwd(), "../../../soko-money/db", migration),
              "utf8"
            )
          )
        }

        const container: MedusaContainer = getContainer()
        const fixture = await createPricedCart("SIFALO-SWEEP", "pp_sifalo_sifalo")
        const sellerModule: any = container.resolve(MercurModules.SELLER)
        await sellerModule.updateSellers({
          id: fixture.seller.seller.id,
          status: SellerStatus.OPEN,
        })

        await api.post(
          `/vendor/stock-locations/${fixture.stockLocation.id}/fulfillment-sets`,
          { name: "Sifalo Sweep Fulfillment", type: "shipping" },
          fixture.seller.headers
        )
        const fulfillmentSet = (
          await api.get(
            `/vendor/stock-locations/${fixture.stockLocation.id}?fields=*fulfillment_sets`,
            fixture.seller.headers
          )
        ).data.stock_location.fulfillment_sets[0]
        await api.post(
          `/vendor/stock-locations/${fixture.stockLocation.id}/fulfillment-providers`,
          { add: ["manual_manual"] },
          fixture.seller.headers
        )
        const serviceZone = (
          await api.post(
            `/vendor/fulfillment-sets/${fulfillmentSet.id}/service-zones`,
            {
              name: "Sifalo Sweep Zone",
              geo_zones: [{ type: "country", country_code: "us" }],
            },
            fixture.seller.headers
          )
        ).data.fulfillment_set.service_zones[0]
        const shippingOption = (
          await api.post(
            "/vendor/shipping-options",
            {
              name: "Sifalo Sweep Shipping",
              service_zone_id: serviceZone.id,
              shipping_profile_id: fixture.shippingProfile.id,
              provider_id: "manual_manual",
              price_type: "flat",
              type: {
                label: "Standard",
                description: "Standard shipping",
                code: "standard",
              },
              prices: [{ currency_code: "usd", amount: 500 }],
              rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" }],
            },
            fixture.seller.headers
          )
        ).data.shipping_option

        await api.post(
          `/store/carts/${fixture.cart.id}/line-items`,
          { offer_id: fixture.offer.id, quantity: 1 },
          fixture.storeHeaders
        )
        await api.post(
          `/store/carts/${fixture.cart.id}/shipping-methods`,
          { option_id: shippingOption.id },
          fixture.storeHeaders
        )

        const requests: Record<string, unknown>[] = []
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
          async (_url: string | URL | Request, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
            requests.push(body)
            if (body.gateway === "checkout") {
              return new Response(JSON.stringify({ key: "key-1", token: "token-1" }))
            }
            return new Response(
              JSON.stringify({
                sid: "sid-paid-without-return",
                amount: "47.00",
                status: "success",
                code: 601,
              })
            )
          }
        )

        try {
          const collection = (
            await api.post(
              "/store/payment-collections",
              { cart_id: fixture.cart.id },
              fixture.storeHeaders
            )
          ).data.payment_collection
          const initializedCollection = (
            await api.post(
              `/store/payment-collections/${collection.id}/payment-sessions`,
              { provider_id: "pp_sifalo_sifalo" },
              fixture.storeHeaders
            )
          ).data.payment_collection
          const session = initializedCollection.payment_sessions.find(
            (candidate: Record<string, unknown>) =>
              candidate.provider_id === "pp_sifalo_sifalo"
          )

          expect(session.data.sid).toBeUndefined()
          const swept = await sweepPaidSifaloSessions(container, { minimumAgeMs: 0 })

          expect(swept.failures).toEqual([])
          expect(swept.completed).toHaveLength(1)
          expect(swept.completed[0]).toMatchObject({ cartId: fixture.cart.id })
          const { data: orderGroups } = await container
            .resolve(ContainerRegistrationKeys.QUERY)
            .graph({
              entity: "order_group",
              fields: ["id", "cart_id", "orders.id"],
              filters: { id: swept.completed[0].orderGroupId },
            })
          expect(orderGroups).toHaveLength(1)
          expect(orderGroups[0]).toMatchObject({ cart_id: fixture.cart.id })
          expect(orderGroups[0].orders).toHaveLength(1)
          expect(requests).toEqual([
            expect.objectContaining({ gateway: "checkout", order_id: expect.any(String) }),
            { order_id: expect.any(String) },
            { sid: "sid-paid-without-return" },
          ])
        } finally {
          fetchSpy.mockRestore()
        }
      })
    })
  },
})
