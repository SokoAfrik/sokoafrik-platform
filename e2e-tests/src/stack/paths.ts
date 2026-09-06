import { resolve } from "path"

export const E2E_ROOT = resolve(__dirname, "..", "..")
export const ADMIN_HOST_DIR = resolve(E2E_ROOT, "hosts", "admin")
export const VENDOR_HOST_DIR = resolve(E2E_ROOT, "hosts", "vendor")
export const MEDUSA_CONFIG_PATH = resolve(E2E_ROOT, "medusa-config.ts")
export const STACK_STATE_FILE = resolve(E2E_ROOT, ".stack.json")

// apps/storefront is a Next.js app outside e2e-tests, started in place rather than via a host
// sub-package: there is no package to mount, the app IS the surface under test.
export const STOREFRONT_DIR = resolve(E2E_ROOT, "..", "apps", "storefront")
