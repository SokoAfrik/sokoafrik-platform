import { type Page, type Locator } from "@playwright/test"

// Page object for the dashboard login screen. Admin and vendor panels render the
// same login UI, so this object is area-agnostic. It encapsulates actions, never
// exposes raw locators to tests as steps, and holds no assertions — tests own
// every expect(). Navigation is relative; baseURL is provided by the fixture.
export class LoginPage {
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(private readonly page: Page) {
    this.emailInput = page.getByRole("textbox", { name: "Email" })
    // Medusa 2.18 renders a LABELLED password textbox with a "Show password" toggle beside it,
    // not a placeholder, and the submit button says "Log in", not "Continue with email". Both
    // locators were written against an older dashboard and had never been run — the browser
    // filled Email and then timed out for 15s looking for a placeholder that does not exist.
    // Role-based locators are what Playwright recommends and they survive copy changes better.
    this.passwordInput = page.getByRole("textbox", { name: "Password" })
    this.submitButton = page.getByRole("button", { name: /log in/i })
    this.errorMessage = page.getByRole("alert")
  }

  async goto() {
    await this.page.goto("/login")
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}
