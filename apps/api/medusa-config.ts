import { loadEnv } from '@medusajs/framework/utils'
import { withMercur } from '@mercurjs/core'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// SIFALO — the collection rail (decision 2026-08-24: money in is Sifalo Pay,
// money out is bank transfer). Registered ONLY when credentials are present.
// There is no merchant account yet — it comes with the Somali registration —
// and the provider refuses to start without one, so an unconditional entry here
// would stop the API booting. Off until someone sets the env, which is the same
// shape as L9's real payout rail: shipped, proven, and deliberately inert.
const SIFALO = process.env.SIFALO_USERNAME && process.env.SIFALO_KEY && process.env.SIFALO_RETURN_URL
  ? [{
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            resolve: '@mercurjs/core/providers/sifalo',
            id: 'sifalo',
            options: {
              username: process.env.SIFALO_USERNAME,
              key: process.env.SIFALO_KEY,
              returnUrl: process.env.SIFALO_RETURN_URL,
              ...(process.env.SIFALO_BASE_URL ? { baseUrl: process.env.SIFALO_BASE_URL } : {}),
            },
          },
        ],
      },
    }]
  : []

module.exports = withMercur({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      vendorCors: process.env.VENDOR_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  featureFlags: {
    seller_registration: true
  },
  modules: [
    ...SIFALO,
    {
      resolve: '@mercurjs/core/modules/admin-ui',
      options: {
        appDir: '',
        path: '/dashboard',
        disable: true
      }
    },
    {
      resolve: '@mercurjs/core/modules/vendor-ui',
      options: {
        appDir: '',
        path: '/seller',
        disable: true
      }
    },
    {
      resolve: '@medusajs/medusa/cache-redis',
      options: { redisUrl: REDIS_URL },
    },
    {
      resolve: '@medusajs/medusa/event-bus-redis',
      options: { redisUrl: REDIS_URL },
    },
    {
      resolve: '@medusajs/medusa/workflow-engine-redis',
      options: { redis: { url: REDIS_URL } },
    },
    {
      resolve: '@medusajs/medusa/locking',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/locking-redis',
            id: 'locking-redis',
            is_default: true,
            options: { redisUrl: REDIS_URL },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: {
              // The local provider bakes this into every uploaded file URL.
              // It must be the publicly reachable origin in production, or
              // images resolve to localhost and render broken.
              backend_url: process.env.FILE_BACKEND_URL || 'http://localhost:9000/static',
            },
          },
        ],
      },
    },
  ],
})
