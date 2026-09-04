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
  env: { MEDUSA_FF_PRODUCT_REQUEST: "false" },
  testSuite: ({ api, getContainer }) => {
    describe("Checkout totals", () => {
      const createPricedCart = async (fixture: string) => {
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
          [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
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

        return { cart, offer, storeHeaders }
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
    })
  },
})
