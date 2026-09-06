import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MedusaContainer } from "@medusajs/framework/types"
import { createElement } from "../../../vendor/node_modules/react"
import { renderToStaticMarkup } from "../../../vendor/node_modules/react-dom/server"

import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user"
import { OnboardingChecklist } from "../../../vendor/src/components/store-setup/onboarding-checklist"
import { getOnboardingSteps } from "../../../vendor/src/components/store-setup/onboarding-gates"

jest.setTimeout(120000)

const labels = {
  profile: "Add your business name, category and city",
  phone: "Verify your phone number",
  terms: "Accept the seller agreement",
  bank: "Add your bank account",
  bank_verified: "Verify your bank account",
  catalogue: "Add at least three complete products",
}

medusaIntegrationTestRunner({
  testSuite: ({ getContainer, api }) => {
    describe("Vendor onboarding checklist", () => {
      let appContainer: MedusaContainer

      beforeAll(() => {
        appContainer = getContainer()
      })

      it("six_gates_render_current_state_test", async () => {
        const { seller, headers } = await createSellerUser(appContainer, {
          email: "onboarding-state@test.com",
          name: "Hodan Electronics",
        })

        await api.post(
          `/vendor/sellers/${seller.id}/address`,
          { city: "Mogadishu", country_code: "so" },
          headers,
        )
        await api.post(
          `/vendor/sellers/${seller.id}/payment-details`,
          { holder_name: "Hodan Electronics", account_number: "TEST-001" },
          headers,
        )
        await api.post(
          `/vendor/sellers/${seller.id}`,
          {
            metadata: {
              soko_onboarding: {
                category: "electronics",
                phone_verified_at: null,
                terms_accepted_at: "2026-09-06T00:00:00.000Z",
                terms_version: "v1",
                current_terms_version: "v1",
                bank_verified_at: null,
                publishable_products: 3,
                minimum_publishable_products: 3,
              },
            },
          },
          headers,
        )

        const response = await api.get(`/vendor/sellers/${seller.id}`, headers)
        expect(response.status).toBe(200)

        const steps = getOnboardingSteps(response.data.seller).map((step) => ({
          ...step,
          label: labels[step.key],
        }))
        const markup = renderToStaticMarkup(createElement(OnboardingChecklist, {
          steps,
          completeLabel: "Complete",
          incompleteLabel: "Not complete",
        }))

        expect(steps).toHaveLength(6)
        expect(markup.match(/data-gate=/g)).toHaveLength(6)
        expect(markup).toContain('data-gate="profile" data-status="complete"')
        expect(markup).toContain('data-gate="phone" data-status="incomplete"')
        expect(markup).toContain('data-gate="terms" data-status="complete"')
        expect(markup).toContain('data-gate="bank" data-status="complete"')
        expect(markup).toContain('data-gate="bank_verified" data-status="incomplete"')
        expect(markup).toContain('data-gate="catalogue" data-status="complete"')
        Object.values(labels).forEach((label) => expect(markup).toContain(label))
      })
    })
  },
})
