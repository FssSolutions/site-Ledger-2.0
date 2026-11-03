#!/usr/bin/env bash
# Two simultaneous record_invoice() calls for the same sessions: exactly one
# must win, the other must fail without leaving an invoice behind.
set -euo pipefail
PSQL=(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -qAt)

"${PSQL[@]}" <<'SQL'
begin;
select tests.as_superuser();
insert into auth.users (id, email) values ('cccccccc-0000-0000-0000-000000000003', 'c@example.test');
select tests.as_user('cccccccc-0000-0000-0000-000000000003');
insert into public.jobs (id, name, rate) values ('c0000000-0000-0000-0000-00000000000c', 'C job', 65);
insert into public.sessions (id, job_id, start_time, end_time) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', '2026-10-01 08:00-07', '2026-10-01 16:00-07');
commit;
SQL

call() { # $1 = invoice id, $2 = sleep seconds held inside the transaction
  "${PSQL[@]}" <<SQL
begin;
select tests.as_user('cccccccc-0000-0000-0000-000000000003');
select public.record_invoice(
  jsonb_build_object('id', '$1', 'status', 'unpaid', 'date_generated', '2026-10-05', 'notes', '$1',
                     'subtotal', 520.00, 'tax_rate', 0, 'tax_amount', 0, 'calculated_total', 520.00, 'amount', 520.00),
  array['c1000000-0000-0000-0000-000000000001']::uuid[],
  jsonb_build_array(jsonb_build_object('session_id', 'c1000000-0000-0000-0000-000000000001', 'quantity', 8, 'unit', 'hour', 'unit_price', 65, 'amount', 520.00)));
select pg_sleep($2);
commit;
SQL
}

set +e
call c2000000-0000-0000-0000-000000000001 2 >/dev/null 2>&1 & P1=$!
sleep 0.5
call c2000000-0000-0000-0000-000000000002 0 >/dev/null 2>&1 & P2=$!
wait $P1; R1=$?
wait $P2; R2=$?
set -e

INVOICES=$("${PSQL[@]}" -c "select count(*) from public.invoices where user_id = 'cccccccc-0000-0000-0000-000000000003'")
CLAIMED=$("${PSQL[@]}" -c "select count(distinct invoice_id) from public.sessions where user_id = 'cccccccc-0000-0000-0000-000000000003' and invoice_id is not null")

# Clean up committed fixtures.
# Production foreign keys do not cascade, so remove children first.
for t in invoices sessions jobs; do
  "${PSQL[@]}" -c "delete from public.$t where user_id = 'cccccccc-0000-0000-0000-000000000003'" >/dev/null
done
"${PSQL[@]}" -c "delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000003'" >/dev/null

if [[ $R1 -eq 0 && $R2 -ne 0 && $INVOICES == 1 && $CLAIMED == 1 ]]; then
  echo "concurrent_invoice: passed (first call won, second was rejected, 1 invoice)"
else
  echo "concurrent_invoice: FAILED r1=$R1 r2=$R2 invoices=$INVOICES claimed_by=$CLAIMED" >&2
  exit 1
fi
