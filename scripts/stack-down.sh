#!/usr/bin/env bash
# Stop the applications. The database and Redis keep running and keep their data;
# `docker compose down` stops those too, and only `docker compose down -v` throws
# the shop away — which is deliberately three separate decisions.
set -uo pipefail
cd "$(dirname "$0")/.."
for f in .stack-api.pid .stack-shop.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  kill "$pid" 2>/dev/null && echo "stopped $f ($pid)" || echo "$f was not running"
  rm -f "$f"
done
echo "postgres and redis are still up (docker compose ps); 'docker compose down' stops them."
