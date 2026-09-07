import { readFileSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  IRegionModuleService,
  ISalesChannelModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules, SellerStatus } from "@mercurjs/types"
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"
import { createVendorProduct } from "../../../../integration-tests/helpers/create-product"
import {
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../integration-tests/helpers/create-admin-user"
import { writeCapturedOrderToLedger } from "../../src/workflows/hooks/write-capture-ledger"

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: { MEDUSA_FF_PRODUCT_REQUEST: "false" },
  testSuite: ({ api, getContainer, dbConnection }) => {
    describe("Checkout ledger capture", () => {
      beforeEach(async () => {
        for (const migration of ["001_ledger.sql", "016_escrow_accounts.sql"]) {
          const sql = readFileSync(
            path.resolve(process.cwd(), "../../../soko-money/db", migration),
            "utf8"
          )
          await dbConnection.raw(sql)
        }

      })
      it.each([
        { title: "split_legs_sum_to_zero_test", replayCount: 0 },
        { title: "replayed_capture_is_idempotent_test", replayCount: 2 },
      ])("$title", async ({ replayCount }) => {
        const container: MedusaContainer = getContainer()
        const sellerResult = await createSellerUser(container, {
          email: "ledger-capture@sokoafrik.test",
          name: "Ledger Capture Seller",
        })
        const sellerModule: any = container.resolve(MercurModules.SELLER)
        await sellerModule.updateSellers({
          id: sellerResult.seller.id,
          status: SellerStatus.OPEN,
        })

        const salesChannel = await container
          .resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
          .createSalesChannels({ name: "Ledger Capture Channel" })
        const region = await container
          .resolve<IRegionModuleService>(Modules.REGION)
          .createRegions({
            name: "Ledger Capture Region",
            currency_code: "usd",
            countries: ["us"],
          })
        await container.resolve(ContainerRegistrationKeys.LINK).create({
          [Modules.REGION]: { region_id: region.id },
          [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
        })

        const stockLocation = (
          await api.post(
            "/vendor/stock-locations",
            { name: "Ledger Capture Warehouse" },
            sellerResult.headers
          )
        ).data.stock_location
        await api.post(
          `/vendor/stock-locations/${stockLocation.id}/fulfillment-sets`,
          { name: "Ledger Capture Fulfillment", type: "shipping" },
          sellerResult.headers
        )
        const location = await api.get(
          `/vendor/stock-locations/${stockLocation.id}?fields=*fulfillment_sets`,
          sellerResult.headers
        )
        const fulfillmentSet = location.data.stock_location.fulfillment_sets[0]
        const serviceZone = (
          await api.post(
            `/vendor/fulfillment-sets/${fulfillmentSet.id}/service-zones`,
            {
              name: "Ledger Capture Zone",
              geo_zones: [{ type: "country", country_code: "us" }],
            },
            sellerResult.headers
          )
        ).data.fulfillment_set.service_zones.find(
          (zone: any) => zone.name === "Ledger Capture Zone"
        )
        const shippingProfile = (
          await api.post(
            "/vendor/shipping-profiles",
            { name: "Ledger Capture Profile", type: "default" },
            sellerResult.headers
          )
        ).data.shipping_profile
        await api.post(
          `/vendor/stock-locations/${stockLocation.id}/fulfillment-providers`,
          { add: ["manual_manual"] },
          sellerResult.headers
        )
        await api.post(
          `/vendor/stock-locations/${stockLocation.id}/sales-channels`,
          { add: [salesChannel.id] },
          sellerResult.headers
        )
        await api.post(
          "/vendor/shipping-options",
          {
            name: "Ledger Capture Shipping",
            service_zone_id: serviceZone.id,
            shipping_profile_id: shippingProfile.id,
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
          sellerResult.headers
        )

        const product = await createVendorProduct(api, sellerResult.headers, {
          title: "Ledger Capture Product",
          sku: "LEDGER-CAPTURE-VARIANT",
        })
        await api.post(
          `/vendor/sales-channels/${salesChannel.id}/products`,
          { add: [product.id] },
          sellerResult.headers
        )
        const offer = (
          await api.post(
            "/vendor/offers",
            {
              sku: "LEDGER-CAPTURE-OFFER",
              variant_id: product.variants[0].id,
              shipping_profile_id: shippingProfile.id,
              inventory_items: [{
                title: "Ledger Capture Inventory",
                required_quantity: 1,
                stock_levels: [{ location_id: stockLocation.id, stocked_quantity: 10 }],
              }],
              prices: [{ amount: 4200, currency_code: "usd" }],
            },
            sellerResult.headers
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
        await api.post(
          `/store/carts/${cart.id}/line-items`,
          { offer_id: offer.id, quantity: 1 },
          storeHeaders
        )
        const shippingOptions = (
          await api.get(`/store/shipping-options?cart_id=${cart.id}`, storeHeaders)
        ).data.shipping_options as Record<string, any[]>
        const selected = Object.values(shippingOptions).flat()[0]
        await api.post(
          `/store/carts/${cart.id}/shipping-methods`,
          { option_id: selected.id },
          storeHeaders
        )
        const paymentCollection = (
          await api.post(
            "/store/payment-collections",
            { cart_id: cart.id },
            storeHeaders
          )
        ).data.payment_collection
        await api.post(
          `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          storeHeaders
        )

        const completed = await api.post(
          `/store/carts/${cart.id}/complete`,
          {},
          storeHeaders
        )
        expect(completed.status).toBe(200)

        const beforeCapture = await dbConnection.raw(
          "SELECT count(*)::int AS count FROM ledger_entries"
        )
        expect(beforeCapture.rows[0].count).toBe(0)

        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: orderGroups } = await query.graph({
          entity: "order_group",
          fields: ["orders.cart.payment_collection.payments.id"],
          filters: { id: completed.data.order_group.id },
        })
        const paymentId = (orderGroups[0] as any)
          .orders[0].cart.payment_collection.payments[0].id
        const captured = await api.post(
          `/vendor/payments/${paymentId}/capture`,
          {},
          sellerResult.headers
        )
        expect(captured.status).toBe(200)

        let capturedEntries = 0
        for (let attempt = 0; attempt < 80; attempt++) {
          const result = await dbConnection.raw(
            "SELECT count(*)::int AS count FROM ledger_entries"
          )
          capturedEntries = result.rows[0].count
          if (capturedEntries === 2) break
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        expect(capturedEntries).toBe(2)

        await Promise.all(
          Array.from({ length: replayCount }, () =>
            writeCapturedOrderToLedger(
              container,
              completed.data.order_group.id
            )
          )
        )

        const journal = await dbConnection.raw(`
          SELECT e.transfer_id::text, e.amount_minor::text, e.currency::text, e.reason,
                 a.kind::text
            FROM ledger_entries e
            JOIN ledger_accounts a ON a.id = e.account_id
           ORDER BY e.amount_minor DESC
        `)
        expect(journal.rows).toEqual([
          expect.objectContaining({
            amount_minor: "4700",
            currency: "USD",
            reason: "capture",
            kind: "platform_float",
          }),
          expect.objectContaining({
            amount_minor: "-4700",
            currency: "USD",
            reason: "capture",
            kind: "vendor_held",
          }),
        ])
        expect(new Set(journal.rows.map((row: any) => row.transfer_id)).size).toBe(1)
        expect(journal.rows.reduce(
          (sum: bigint, row: any) => sum + BigInt(row.amount_minor),
          0n
        )).toBe(0n)
      })
    })
  },
})
