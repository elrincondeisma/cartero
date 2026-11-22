#!/usr/bin/env bash
# Levanta dos instancias de Cartero aisladas para las pruebas E2E (las usa playwright.config.ts):
#   :3201  base de datos cartero_e2e        (ya instalada: la prepara e2e/global-setup.ts)
#   :3202  base de datos cartero_e2e_setup  (vacía, para probar el asistente de instalación)
# Cada arranque empieza con las bases de datos vacías. Nunca toca la base de datos de desarrollo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_URL="${E2E_PG_URL:-postgres://cartero:cartero@localhost:5433}"

pnpm --dir "$ROOT" --filter @cartero/web build >/dev/null

for db in cartero_e2e cartero_e2e_setup; do
  psql "$PG_URL/postgres" -qc "drop database if exists $db with (force)" 2>/dev/null \
    || docker exec "$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)" psql -U cartero -d postgres -qc "drop database if exists $db with (force)"
  psql "$PG_URL/postgres" -qc "create database $db" 2>/dev/null \
    || docker exec "$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)" psql -U cartero -d postgres -qc "create database $db"
done

cd "$ROOT/apps/server"
start() {
  PORT=$1 DATABASE_URL="$PG_URL/$2" REDIS_URL="redis://localhost:6380/$3" WEB_DIST="$ROOT/apps/web/dist" \
    PUBLIC_URL="http://127.0.0.1:$1" FILES_DIR="/tmp/cartero-e2e-files-$1" LOG_LEVEL=warn \
    npx tsx src/index.ts &
}
start 3201 cartero_e2e 5
start 3202 cartero_e2e_setup 6
trap 'kill 0' EXIT
wait
