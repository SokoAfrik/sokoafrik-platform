#!/usr/bin/env bash
# Bring SokoAfrik up and LEAVE IT UP.
#
# The e2e harness can already boot this platform, but it owns the stack for the
# length of a test run and drops the database at the end. That is right for a
# test and useless for looking at the product. This starts the same pieces
# against a persistent database and stays out of the way.
#
# Ports are fixed (not random like the test harness) so the URLs are the same
# every time and can be bookmarked. Nothing binds to a public interface.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

PG_PORT="${POSTGRES_PORT:-5433}"
REDIS_PORT="${REDIS_PORT:-6380}"
API_PORT="${API_PORT:-9000}"
SHOP_PORT="${SHOP_PORT:-3000}"
PGPASS="${POSTGRES_PASSWORD:-postgres}"
DB_URL="postgres://postgres:${PGPASS}@localhost:${PG_PORT}/sokoafrik"

say() { printf '\n== %s\n' "$*"; }

say "infrastructure"
docker compose up -d
for i in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker compose exec -T postgres pg_isready -U postgres

export DATABASE_URL="$DB_URL"
export REDIS_URL="redis://localhost:${REDIS_PORT}"
export JWT_SECRET="${JWT_SECRET:-dev-only-not-a-production-secret}"
export COOKIE_SECRET="${COOKIE_SECRET:-dev-only-not-a-production-secret}"
export STORE_CORS="http://localhost:${SHOP_PORT}"
export ADMIN_CORS="http://localhost:${SHOP_PORT}"
export AUTH_CORS="http://localhost:${SHOP_PORT}"
export VENDOR_CORS="http://localhost:${SHOP_PORT}"

say "migrations"
(cd apps/api && npx --no-install medusa db:migrate)

# Seeding is opt-in: running it twice against a live shop is not something to do
# by accident. SEED=1 ./scripts/stack-up.sh on a fresh database.
if [ "${SEED:-0}" = "1" ]; then
  say "seed"
  (cd apps/api && npx --no-install medusa exec ./src/scripts/seed.ts)
fi

say "publishable key"
KEY=$(psql "$DB_URL" -tAc "select token from api_key where type='publishable' and revoked_at is null order by created_at limit 1" | tr -d '[:space:]')
if [ -z "$KEY" ]; then
  echo "No publishable API key in the database. The shop cannot authenticate to the store API," >&2
  echo "and will render an empty page that looks like an empty catalogue. Run with SEED=1 first." >&2
  exit 1
fi
echo "   found: ${KEY:0:12}..."

say "api on :${API_PORT}"
(cd apps/api && PORT="$API_PORT" nohup bun run start > "$ROOT/.stack-api.log" 2>&1 & echo $! > "$ROOT/.stack-api.pid")

say "shop on :${SHOP_PORT}"
(cd apps/storefront && \
  MEDUSA_BACKEND_URL="http://localhost:${API_PORT}" \
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$KEY" \
  NEXT_PUBLIC_DEFAULT_REGION="${REGION:-de}" \
  NEXT_PUBLIC_BASE_URL="http://localhost:${SHOP_PORT}" \
  NEXT_PUBLIC_SITE_NAME="SokoAfrik" \
  nohup bun run dev -- --port "$SHOP_PORT" > "$ROOT/.stack-shop.log" 2>&1 & echo $! > "$ROOT/.stack-shop.pid")

say "up"
cat <<TXT
  shop:  http://localhost:${SHOP_PORT}/de
  api:   http://localhost:${API_PORT}
  logs:  .stack-api.log  .stack-shop.log
  stop:  ./scripts/stack-down.sh
TXT
