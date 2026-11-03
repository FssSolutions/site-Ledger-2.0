-- MANUAL, ONE ACCOUNT ONLY. Not a migration; never run automatically.
--
-- Purpose: record that one account's completed sessions that started before
-- 2026-10-25 00:00 America/Vancouver were already billed in QuickBooks, by
-- grouping them under a single "Billed before Oct 25, 2026" invoice record.
--
-- This is the backfill that previously lived inside
-- 20261102120000_session_billing.sql, where it ran for EVERY account.
--
-- Run with psql (it uses \\set):  psql "$DATABASE_URL" -f <this file>
--
-- Before running:
--   1. Take a backup (Dashboard > Database > Backups, or pg_dump).
--   2. Run the AUDIT query at the bottom first to see whether the original
--      migration already did this (it likely did, if that migration was applied).
--   3. Replace the placeholder uuid below with the intended account's user id.
--
-- The whole script runs in one transaction and only touches that account.
-- It is safe to re-run: sessions that already have an invoice are skipped.
-- To undo: delete the created invoice record; its sessions return to unbilled.

begin;

\set target_user '00000000-0000-0000-0000-000000000000'

select set_config('sl.target_user', :'target_user', true);
do $$
begin
  if current_setting('sl.target_user')::uuid = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Set target_user to the intended account id before running.';
  end if;
  if not exists (select 1 from auth.users where id = current_setting('sl.target_user')::uuid) then
    raise exception 'No auth user with that id.';
  end if;
end $$;

with cutoff as (select timestamptz '2026-10-25 00:00:00 America/Vancouver' as ts),
eligible as (
  select s.id from public.sessions s, cutoff
  where s.user_id = :'target_user'::uuid
    and s.invoice_id is null and s.end_time is not null and s.start_time < cutoff.ts
),
created as (
  insert into public.invoices (user_id, customer_name, amount, status, date_generated, date_range_end, notes)
  select :'target_user'::uuid, '', 0, 'paid', date '2026-10-24', date '2026-10-24', 'Billed before Oct 25, 2026'
  where exists (select 1 from eligible)
  returning id
)
update public.sessions s set invoice_id = created.id
from created, eligible
where s.id = eligible.id;

commit;

-- AUDIT (read-only): which accounts already have backfill records, and how
-- many sessions each one claims. Accounts other than the intended one appearing
-- here were affected by the original all-accounts migration. Do NOT delete
-- those records automatically; review them with the account owner first.
--
-- select i.user_id, i.id as invoice_id, i.created_at, count(s.id) as sessions
-- from public.invoices i left join public.sessions s on s.invoice_id = i.id
-- where i.notes = 'Billed before Oct 25, 2026'
-- group by i.user_id, i.id, i.created_at order by i.created_at;
