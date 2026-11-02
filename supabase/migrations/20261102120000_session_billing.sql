-- Track which invoice each time entry was billed on, so Site Ledger knows
-- which hours are still unbilled. Deleting an invoice releases its hours.
do $$
declare id_type text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'invoice_id'
  ) then
    select format_type(a.atttypid, a.atttypmod) into id_type
    from pg_attribute a
    where a.attrelid = 'public.invoices'::regclass and a.attname = 'id';
    execute format(
      'alter table sessions add column invoice_id %s references invoices(id) on delete set null',
      coalesce(id_type, 'uuid')
    );
  end if;
end $$;

create index if not exists sessions_invoice_id_idx on sessions (invoice_id);

-- One-time backfill: everything up to and including Oct 24, 2026 (Vancouver time)
-- was already billed in QuickBooks. Group it under one record per user so it can
-- be undone by deleting that record.
with cutoff as (
  select timestamptz '2026-10-25 00:00:00 America/Vancouver' as ts
),
owners as (
  select distinct s.user_id
  from sessions s, cutoff
  where s.invoice_id is null and s.end_time is not null and s.start_time < cutoff.ts
),
created as (
  insert into invoices (user_id, customer_name, amount, status, date_generated, date_range_end, notes)
  select user_id, '', 0, 'paid', date '2026-10-24', date '2026-10-24', 'Billed before Oct 25, 2026'
  from owners
  returning id, user_id
)
update sessions s
set invoice_id = created.id
from created, cutoff
where s.user_id = created.user_id
  and s.invoice_id is null
  and s.end_time is not null
  and s.start_time < cutoff.ts;

notify pgrst, 'reload schema';
