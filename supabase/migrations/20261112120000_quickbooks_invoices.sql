-- Site Ledger: invoices created in QuickBooks Online (docs/QUICKBOOKS_PLAN.md,
-- phase 1, invoice step).
--
-- What this migration does:
--   1. Adds qbo_* columns to invoices: the QuickBooks invoice id and number,
--      a status, and the totals QuickBooks calculated. The existing invoice
--      amounts stay immutable; QuickBooks figures are stored beside them.
--   2. Lets only the server (Edge Functions, service role) write those
--      columns, and makes the QuickBooks invoice id write-once.
--   3. Adds qbo_customer_links: which QuickBooks customer a SiteLedger
--      customer corresponds to, per QuickBooks company. Kept out of the
--      customers table so linking never changes a customer row (and so never
--      conflicts with an offline edit). No access for app users.
--   4. qbo_status() now also reports invoices_ready, so the app only offers
--      "Create in QuickBooks" once this migration is in place.
--
-- Additive only: no existing row is rewritten and ledger_schema_version() is
-- not bumped (older app builds are unaffected). Safe to re-run.
-- Requires 20261111120000_quickbooks_connection.sql.

do $$
begin
  if to_regclass('public.qbo_connections') is null then
    raise exception 'QuickBooks invoices migration aborted: apply 20261111120000_quickbooks_connection.sql first. No changes were made.';
  end if;
end $$;

-------------------------------------------------------------------------------
-- 1. Invoice columns
-------------------------------------------------------------------------------
alter table public.invoices add column if not exists qbo_invoice_id text;
alter table public.invoices add column if not exists qbo_doc_number text;
-- NULL: recorded by hand (not created by SiteLedger in QuickBooks).
-- pending/failed: recorded here, not in QuickBooks yet.  created: in QuickBooks.
-- voided/deleted: reserved for the paid-status sync step.
alter table public.invoices add column if not exists qbo_status text;
alter table public.invoices add column if not exists qbo_realm_id text;
alter table public.invoices add column if not exists qbo_total numeric(12,2);
alter table public.invoices add column if not exists qbo_tax numeric(12,2);
alter table public.invoices add column if not exists qbo_balance numeric(12,2);
alter table public.invoices add column if not exists qbo_error text;
alter table public.invoices add column if not exists qbo_synced_at timestamptz;
-- Counts requests QuickBooks definitely refused, so a corrected retry is
-- sent as a new request while a retry after a lost reply is recognised.
alter table public.invoices add column if not exists qbo_attempt integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_qbo_status_valid') then
    alter table public.invoices add constraint invoices_qbo_status_valid
      check (qbo_status is null or qbo_status in ('pending', 'created', 'failed', 'voided', 'deleted'));
  end if;
end $$;

-- A QuickBooks invoice belongs to at most one SiteLedger invoice.
create unique index if not exists invoices_qbo_invoice_key
  on public.invoices (qbo_realm_id, qbo_invoice_id) where qbo_invoice_id is not null;

-------------------------------------------------------------------------------
-- 2. Only the server writes QuickBooks fields
-------------------------------------------------------------------------------
create or replace function public.sl_guard_invoice_qbo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.qbo_invoice_id is not null and new.qbo_invoice_id is distinct from old.qbo_invoice_id then
    raise exception 'the QuickBooks invoice id cannot be changed once set' using errcode = '42501';
  end if;
  -- App users (including record_invoice(), which runs as the caller) may not
  -- set or change any QuickBooks field.
  if current_user = 'authenticated' and (
       new.qbo_invoice_id is distinct from (case when tg_op = 'UPDATE' then old.qbo_invoice_id end)
    or new.qbo_doc_number is distinct from (case when tg_op = 'UPDATE' then old.qbo_doc_number end)
    or new.qbo_status is distinct from (case when tg_op = 'UPDATE' then old.qbo_status end)
    or new.qbo_realm_id is distinct from (case when tg_op = 'UPDATE' then old.qbo_realm_id end)
    or new.qbo_total is distinct from (case when tg_op = 'UPDATE' then old.qbo_total end)
    or new.qbo_tax is distinct from (case when tg_op = 'UPDATE' then old.qbo_tax end)
    or new.qbo_balance is distinct from (case when tg_op = 'UPDATE' then old.qbo_balance end)
    or new.qbo_error is distinct from (case when tg_op = 'UPDATE' then old.qbo_error end)
    or new.qbo_synced_at is distinct from (case when tg_op = 'UPDATE' then old.qbo_synced_at end)
    or new.qbo_attempt is distinct from (case when tg_op = 'UPDATE' then old.qbo_attempt else 0 end)) then
    raise exception 'QuickBooks fields are set by the server only' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists sl_guard_invoice_qbo on public.invoices;
create trigger sl_guard_invoice_qbo before insert or update on public.invoices
  for each row execute function public.sl_guard_invoice_qbo();
revoke all on function public.sl_guard_invoice_qbo() from public, anon, authenticated;

-- The Edge Functions update QuickBooks fields on invoices as the service role.
grant select, update on public.invoices to service_role;

-------------------------------------------------------------------------------
-- 3. Customer links
-------------------------------------------------------------------------------
create table if not exists public.qbo_customer_links (
  customer_id uuid not null references public.customers(id) on delete cascade,
  realm_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  qbo_customer_id text not null,
  created_at timestamptz not null default now(),
  primary key (customer_id, realm_id)
);
create index if not exists qbo_customer_links_user_idx on public.qbo_customer_links (user_id);

do $$
declare p record;
begin
  alter table public.qbo_customer_links enable row level security;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'qbo_customer_links' loop
    execute format('drop policy %I on public.qbo_customer_links', p.policyname);
  end loop;
  revoke all on public.qbo_customer_links from public, anon, authenticated;
  grant select, insert, update, delete on public.qbo_customer_links to service_role;
end $$;

-------------------------------------------------------------------------------
-- 4. Status for the app
-------------------------------------------------------------------------------
create or replace function public.qbo_status()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.qbo_connections;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_row from public.qbo_connections where user_id = v_uid;
  if not found then
    return jsonb_build_object('connected', false, 'invoices_ready', true);
  end if;
  return jsonb_build_object(
    'connected', true,
    'status', v_row.status,
    'company_name', v_row.company_name,
    'environment', v_row.environment,
    'connected_at', v_row.connected_at,
    'setup_complete', v_row.labour_item_id is not null and v_row.tax_code_id is not null,
    'invoices_ready', true);
end $$;

revoke all on function public.qbo_status() from public, anon, authenticated;
grant execute on function public.qbo_status() to authenticated;

notify pgrst, 'reload schema';
