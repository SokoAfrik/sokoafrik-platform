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
import { releaseDueEscrow } from "../../src/jobs/release-due-escrow"
import { createDailyWithdrawalRun } from "../../src/jobs/create-daily-withdrawal-run"

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: { MEDUSA_FF_PRODUCT_REQUEST: "false" },
  testSuite: ({ api, getContainer, dbConnection }) => {
    describe("Checkout ledger capture", () => {
      beforeEach(async () => {
        for (const migration of ["001_ledger.sql", "016_escrow_accounts.sql", "028_vendor_identity.sql"]) {
          const sql = readFileSync(
            path.resolve(process.cwd(), "../../../soko-money/db", migration),
            "utf8"
          )
          await dbConnection.raw(sql)
        }

      })
      it.each([
        { title: "capture_writes_balanced_journal_test", replayCount: 0, preCaptureOnly: false, assertOrderIdentity: false, scheduleRelease: false },
        { title: "capture_journal_records_order_identity_test", replayCount: 0, preCaptureOnly: false, assertOrderIdentity: true, scheduleRelease: false },
        { title: "split_legs_sum_to_zero_test", replayCount: 0, preCaptureOnly: false, assertOrderIdentity: false, scheduleRelease: false },
        { title: "replayed_capture_is_idempotent_test", replayCount: 2, preCaptureOnly: false, assertOrderIdentity: false, scheduleRelease: false },
        { title: "no_ledger_write_without_confirmed_capture_test", replayCount: 0, preCaptureOnly: true, assertOrderIdentity: false, scheduleRelease: false },
        { title: "delivered_order_schedules_escrow_release_test", replayCount: 0, preCaptureOnly: false, assertOrderIdentity: true, scheduleRelease: true, releaseDue: false },
        { title: "scheduled_escrow_claimer_posts_balanced_release_test", replayCount: 0, preCaptureOnly: false, assertOrderIdentity: true, scheduleRelease: true, releaseDue: true },
        { title: "scheduled_withdrawal_run_creates_real_payout_row_test", replayCount: 0, preCaptureOnly: false, assertOrderIdentity: true, scheduleRelease: true, releaseDue: true, runWithdrawal: true },
      ].map((testCase) => ({ releaseDue: false, runWithdrawal: false, ...testCase })))("$title", async ({ replayCount, preCaptureOnly, assertOrderIdentity, scheduleRelease, releaseDue, runWithdrawal }) => {
        if (scheduleRelease) {
          for (const migration of [
            "002_payouts.sql",
            "006_bank_destinations.sql",
            "007_bank_only.sql",
            "008_vendor_onboarding.sql",
            "009_admin_settings.sql",
            "015_escrow_hold_setting.sql",
            "017_escrow_release_queue.sql",
            "018_escrow_release_terminal.sql",
            "030_platform_account_uniqueness.sql",
            ...(runWithdrawal ? [
              "003_manual_and_templates.sql",
              "005_withdrawals.sql",
              "010_reconciliation_alert.sql",
              "012_reconciliation_supersession.sql",
              "019_withdrawal_run_destinations.sql",
              "020_daily_withdrawal_runs.sql",
              "021_withdrawal_float_shortfall.sql",
              "022_money_guards.sql",
              "023_payout_release.sql",
              "024_release_lock_order.sql",
              "025_bank_verification_destination.sql",
              "026_withdrawal_run_caps.sql",
              "031_withdrawal_run_reconciliation_gate.sql",
              "033_withdrawal_run_reconciliation_gate_closes.sql",
              "034_reconciliation_gate_config_required.sql",
            ] : []),
          ]) {
            const sql = readFileSync(
              path.resolve(process.cwd(), "../../../soko-money/db", migration),
              "utf8"
            )
            await dbConnection.raw(sql)
          }
        }

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
          fields: [
            "orders.id",
            "orders.display_id",
            "orders.items.id",
            "orders.items.quantity",
            "orders.cart.payment_collection.payments.id",
          ],
          filters: { id: completed.data.order_group.id },
        })
        if (preCaptureOnly) {
          await expect(
            writeCapturedOrderToLedger(container, completed.data.order_group.id)
          ).rejects.toThrow("captured amount must be positive")

          const withoutConfirmedCapture = await dbConnection.raw(`
            SELECT
              (SELECT count(*)::int FROM ledger_transfers) AS transfers,
              (SELECT count(*)::int FROM ledger_entries) AS entries
          `)
          expect(withoutConfirmedCapture.rows[0]).toEqual({
            transfers: 0,
            entries: 0,
          })
          return
        }

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
                 e.sub_order_id::text, e.meta,
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
            kind: "escrow_held",
          }),
        ])
        expect(new Set(journal.rows.map((row: any) => row.transfer_id)).size).toBe(1)
        expect(journal.rows.reduce(
          (sum: bigint, row: any) => sum + BigInt(row.amount_minor),
          0n
        )).toBe(0n)
        if (assertOrderIdentity) {
          const orderIds = (orderGroups[0] as any).orders.map((order: any) => order.id)
          expect(journal.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({
              meta: {
                order_group_id: completed.data.order_group.id,
                order_ids: orderIds,
              },
            }),
          ]))
          expect(journal.rows.every((row: any) => (
            row.meta.order_group_id === completed.data.order_group.id
            && JSON.stringify(row.meta.order_ids) === JSON.stringify(orderIds)
          ))).toBe(true)
        }

        if (scheduleRelease) {
          const order = (orderGroups[0] as any).orders[0]
          const escrowLeg = journal.rows.find((row: any) => row.kind === "escrow_held")
          expect(escrowLeg).toEqual(expect.objectContaining({
            sub_order_id: String(order.display_id),
            amount_minor: "-4700",
          }))

          const fulfillableOrder = (
            await api.get(`/vendor/orders/${order.id}`, sellerResult.headers)
          ).data.order
          const fulfillment = (
            await api.post(
              `/vendor/orders/${order.id}/fulfillments`,
              {
                items: fulfillableOrder.items.map((item: any) => ({
                  id: item.id,
                  quantity: Number(item.quantity),
                })),
                requires_shipping: true,
                location_id: stockLocation.id,
              },
              sellerResult.headers
            )
          ).data.fulfillment

          const delivered = await api.post(
            `/vendor/orders/${order.id}/fulfillments/${fulfillment.id}/mark-as-delivered`,
            {},
            sellerResult.headers
          )
          expect(delivered.status).toBe(200)

          let scheduled: { sub_order_id: string; release_at: Date } | undefined
          for (let attempt = 0; attempt < 80; attempt++) {
            const result = await dbConnection.raw(
              `SELECT sub_order_id::text, release_at
                 FROM escrow_release_queue
                WHERE sub_order_id = ?::bigint`,
              [order.display_id]
            )
            scheduled = result.rows[0]
            if (scheduled) break
            await new Promise((resolve) => setTimeout(resolve, 100))
          }

          const persistedFulfillment = await dbConnection.raw(
            "SELECT delivered_at FROM fulfillment WHERE id = ?",
            [fulfillment.id]
          )
          expect(scheduled?.sub_order_id).toBe(String(order.display_id))
          expect(new Date(scheduled!.release_at).getTime()).toBe(
            new Date(persistedFulfillment.rows[0].delivered_at).getTime()
              + 7 * 24 * 60 * 60 * 1000
          )
          expect(journal.rows.reduce(
            (sum: bigint, row: any) => sum + BigInt(row.amount_minor),
            0n
          )).toBe(0n)

          if (releaseDue) {
            const releaseAt = new Date(scheduled!.release_at)
            const released = await releaseDueEscrow(container, {
              now: new Date(releaseAt.getTime() + 1),
              limit: 1,
              claimToken: "11111111-2222-4333-8444-555555555555",
            })
            expect(released.claimed).toBe(1)
            expect(released.released).toEqual([
              expect.objectContaining({ subOrderId: String(order.display_id) }),
            ])

            const releaseJournal = await dbConnection.raw(
              `SELECT e.transfer_id::text, e.amount_minor::text, e.currency::text,
                      e.reason, e.sub_order_id::text, a.kind::text
                 FROM ledger_entries e
                 JOIN ledger_accounts a ON a.id = e.account_id
                WHERE e.sub_order_id = ?::bigint
                  AND e.reason IN ('release', 'commission')
                ORDER BY e.amount_minor DESC`,
              [order.display_id]
            )
            expect(releaseJournal.rows).toEqual([
              expect.objectContaining({
                amount_minor: "4700",
                currency: "USD",
                reason: "release",
                kind: "escrow_held",
              }),
              expect.objectContaining({
                amount_minor: "-4700",
                currency: "USD",
                reason: "release",
                kind: "vendor_available",
              }),
            ])
            expect(new Set(releaseJournal.rows.map((row: any) => row.transfer_id)).size).toBe(1)
            expect(releaseJournal.rows.reduce(
              (sum: bigint, row: any) => sum + BigInt(row.amount_minor),
              0n
            )).toBe(0n)

            const completedQueue = await dbConnection.raw(
              `SELECT completed_at IS NOT NULL AS completed
                 FROM escrow_release_queue
                WHERE sub_order_id = ?::bigint`,
              [order.display_id]
            )
            expect(completedQueue.rows).toEqual([{ completed: true }])

            if (runWithdrawal) {
              const vendor = await dbConnection.raw(
                `SELECT vendor_id::text
                   FROM vendor_identity
                  WHERE seller_id = ?`,
                [sellerResult.seller.id]
              )
              const payee = await dbConnection.raw(
                `INSERT INTO payees (
                   party_type, party_id, msisdn, network, account_holder,
                   destination, bank_name, bank_account_no, bank_account_name,
                   bank_verified_at, bank_verified_by
                 ) VALUES (
                   'vendor', ?::bigint, '252615111111', 'EVC_PLUS',
                   'Ledger Capture Seller', 'bank_account', 'Test Bank',
                   'TEST-ACCOUNT-1', 'Ledger Capture Seller', now(), 'integration-test'
                 ) RETURNING id::text`,
                [vendor.rows[0].vendor_id]
              )
              const request = await dbConnection.raw(
                `INSERT INTO withdrawal_requests (
                   payee_id, amount_minor, currency, requested_by
                 ) VALUES (?::bigint, 4700, 'USD', 'vendor_web')
                 RETURNING id::text`,
                [payee.rows[0].id]
              )

              const created = await createDailyWithdrawalRun(container, {
                runDate: "2026-09-22",
              })
              expect(created).toEqual([
                expect.objectContaining({ request_id: request.rows[0].id }),
              ])

              const payout = await dbConnection.raw(
                `SELECT p.id::text, p.amount_minor::text, p.currency::text,
                        p.status::text, p.withdrawal_request_id::text,
                        w.status::text AS request_status, w.payout_id::text
                   FROM payouts p
                   JOIN withdrawal_requests w ON w.id = p.withdrawal_request_id
                  WHERE p.withdrawal_request_id = ?::bigint`,
                [request.rows[0].id]
              )
              expect(payout.rows).toEqual([{
                id: created[0].payout_id,
                amount_minor: "4700",
                currency: "USD",
                status: "pending",
                withdrawal_request_id: request.rows[0].id,
                request_status: "queued",
                payout_id: created[0].payout_id,
              }])
            }
          }
        }
      })
    })
  },
})
