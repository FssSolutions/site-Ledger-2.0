#!/usr/bin/env bash
# Runs the database migrations and RLS/invoice tests against a throwaway
# Postgres. Never point this at production.
#
#   TEST_DATABASE_URL=postgres://...  scripts/test-db.sh   # use an existing empty database (CI)
#   scripts/test-db.sh                                      # start a temporary local cluster
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  [[ -x "$PGBIN/initdb" ]] || { echo "Postgres binaries not found; set TEST_DATABASE_URL" >&2; exit 1; }
  TMP="$(mktemp -d)"
  RUNAS=()
  if [[ $(id -u) -eq 0 ]]; then chown postgres "$TMP"; RUNAS=(runuser -u postgres --); fi
  PORT=${TEST_PG_PORT:-54329}
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
  trap '"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  export TEST_DATABASE_URL="postgresql://postgres@/postgres?host=$TMP&port=$PORT"
fi

export PGOPTIONS="-c client_min_messages=warning"
run() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }

echo "== shim + reference baseline (test-only approximation of legacy schema)"
run -f "$ROOT/supabase/tests/00_supabase_shim.sql"
run -f "$ROOT/supabase/tests/01_reference_baseline.sql"

echo "== migrations"
for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$m")"
  run -1 -f "$m"
done
echo "== re-run hardening migration (must be idempotent)"
run -1 -f "$ROOT"/supabase/migrations/20261103120000_security_and_sync_hardening.sql

echo "== precondition check refuses a non-uuid schema"
if psql "$TEST_DATABASE_URL" -X -q -c "create database sl_precheck" >/dev/null 2>&1; then
  pre() { psql "$TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c '\connect sl_precheck' "$@"; }
  pre -f "$ROOT/supabase/tests/00_supabase_shim.sql" >/dev/null
  pre -c "
    create table jobs(id bigint primary key, user_id uuid); create table sessions(id uuid primary key, user_id uuid);
    create table employees(id uuid primary key, user_id uuid); create table mileage(id uuid primary key, user_id uuid);
    create table customers(id uuid primary key, user_id uuid); create table company_profiles(id uuid primary key, user_id uuid);
    create table expenses(id uuid primary key, user_id uuid); create table invoices(id uuid primary key, user_id uuid);" >/dev/null
  if pre -1 -f "$ROOT"/supabase/migrations/20261103120000_security_and_sync_hardening.sql >/dev/null 2>&1; then
    echo "   FAILED: migration ran against bigint ids" >&2; exit 1
  fi
  COLS=$(pre -At -c "select count(*) from information_schema.columns where table_name='jobs' and column_name='version'")
  [[ "$COLS" == 0 ]] || { echo "   FAILED: precondition failure left changes behind" >&2; exit 1; }
  echo "   passed (aborted with no changes)"
  psql "$TEST_DATABASE_URL" -X -q -c "drop database sl_precheck" >/dev/null
else
  echo "   skipped (cannot create databases with this connection)"
fi

echo "== tests"
for t in "$ROOT"/supabase/tests/[1-9]*.sql; do
  OUT=$(run -At -f "$t" 2>&1) || { echo "$OUT" >&2; echo "FAILED: $(basename "$t")" >&2; exit 1; }
  echo "$OUT" | grep -E "passed" || { echo "$OUT" >&2; echo "FAILED: $(basename "$t") produced no pass marker" >&2; exit 1; }
done
echo "== JS/SQL rounding parity (generated cases)"
GEN=$(mktemp)
node "$ROOT/scripts/gen-rounding-cases.mjs" > "$GEN"
OUT=$(run -At -f "$GEN" 2>&1) || { echo "$OUT" | tail -5 >&2; echo "FAILED: rounding parity" >&2; exit 1; }
echo "$OUT" | grep passed
rm -f "$GEN"
for t in "$ROOT"/supabase/tests/[1-9]*.sh; do
  TEST_DATABASE_URL="$TEST_DATABASE_URL" bash "$t"
done
echo "== inspection script runs (read-only smoke test)"
psql "$TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -1 -f "$ROOT/supabase/inspect/inspect_schema.sql" >/dev/null
echo "   passed"
echo "== database tests passed"
