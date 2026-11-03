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

-- NOTE (2026-11-03): this file originally also contained a one-time backfill
-- that marked every account's completed sessions before 2026-10-25 as billed.
-- That reconciliation was personal to one account, so it has been moved to
-- supabase/reconciliation/20261025_mark_prior_sessions_billed.sql, scoped to a
-- single user id, and must be run manually. If this migration was already
-- applied in production, the backfill already ran there; removing it here does
-- not undo anything. See docs/DATABASE.md ("Historical billing backfill").

notify pgrst, 'reload schema';
