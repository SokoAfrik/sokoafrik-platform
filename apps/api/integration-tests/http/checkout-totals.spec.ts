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

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Checkout totals", () => {
      it("computes the cart total from the persisted offer price", async () => {
        const container: MedusaContainer = getContainer()
        const seller = await createSellerUser(container, {
          email: "server-total@sokoafrik.test",
          name: "Server Total Seller",
        })

        const salesChannelModule =
          container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
        const salesChannel = await salesChannelModule.createSalesChannels({
          name: "Server Total Channel",
        })

        const regionModule =
          container.resolve<IRegionModuleService>(Modules.REGION)
        const region = await regionModule.createRegions({
          name: "Server Total Region",
          currency_code: "usd",
          countries: ["us"],
        })

        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create({
          [Modules.REGION]: { region_id: region.id },
          [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
        })

        const stockLocation = (
          await api.post(
            "/vendor/stock-locations",
            { name: "Server Total Warehouse" },
            seller.headers
          )
        ).data.stock_location
        await api.post(
          `/vendor/stock-locations/${stockLocation.id}/sales-channels`,
          { add: [salesChannel.id] },
          seller.headers
        )

        const product = await createVendorProduct(api, seller.headers, {
          title: "Server-priced product",
          sku: "SERVER-TOTAL-VARIANT",
        })
        await api.post(
          `/vendor/sales-channels/${salesChannel.id}/products`,
          { add: [product.id] },
          seller.headers
        )

        const shippingProfile = (
          await api.post(
            "/vendor/shipping-profiles",
            { name: "Server Total Profile", type: "default" },
            seller.headers
          )
        ).data.shipping_profile
        const offer = (
          await api.post(
            "/vendor/offers",
            {
              sku: "SERVER-TOTAL-OFFER",
              variant_id: product.variants[0].id,
              shipping_profile_id: shippingProfile.id,
              inventory_items: [
                {
                  title: "Server Total Inventory",
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
    })
  },
})
