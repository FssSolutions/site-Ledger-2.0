-- Site Ledger: account isolation, sync safety, and billing integrity.
--
-- What this migration does (see docs/DATABASE.md for the rollout plan):
--   1. Checks preconditions and aborts BEFORE changing anything if the live
--      schema differs from what the app expects (missing tables, non-uuid ids).
--   2. Enables RLS on every user-owned table and REPLACES all existing policies
--      on those tables with explicit owner-only policies for `authenticated`.
--      Existing policies are dropped because permissive policies are OR'd
--      together: one broad legacy policy would defeat the new ones.
--   3. Revokes table access from `anon`.
--   4. Makes user_id/id immutable and adds version/updated_at for conflict
--      detection during offline sync.
--   5. Enforces that referenced jobs, employees, customers, invoices and
--      sessions belong to the same account (a foreign key alone does not).
--   6. Adds break and rate-snapshot columns to sessions and totals to invoices.
--   7. Adds immutable invoice_lines and an atomic record_invoice() function.
--   8. Adds a per-user voice quota table and function.
--
-- Additive only: no existing rows are deleted or rewritten, except that new
-- columns receive their defaults. New CHECK constraints are NOT VALID, so
-- existing rows are not re-checked (they are enforced on future writes).
-- Safe to re-run.

-------------------------------------------------------------------------------
-- 1. Preconditions
-------------------------------------------------------------------------------
do $$
declare
  t text;
  v_type text;
begin
  foreach t in array array['jobs','sessions','employees','mileage','customers','company_profiles','expenses','invoices'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Site Ledger hardening aborted: table public.% does not exist. No changes were made.', t;
    end if;
    select format_type(a.atttypid, a.atttypmod) into v_type
      from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attname = 'id' and not a.attisdropped;
    if v_type is distinct from 'uuid' then
      raise exception 'Site Ledger hardening aborted: public.%.id is % (expected uuid). Offline sync assigns uuid ids on the device. No changes were made.', t, coalesce(v_type, 'missing');
    end if;
    select format_type(a.atttypid, a.atttypmod) into v_type
      from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attname = 'user_id' and not a.attisdropped;
    if v_type is distinct from 'uuid' then
      raise exception 'Site Ledger hardening aborted: public.%.user_id is % (expected uuid). No changes were made.', t, coalesce(v_type, 'missing');
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 2. New columns
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['jobs','sessions','employees','mileage','customers','company_profiles','expenses','invoices'] loop
    execute format('alter table public.%I add column if not exists version integer not null default 1', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    -- Rows without an owner are invisible under RLS; forbid new ones.
    if not exists (select 1 from pg_constraint where conrelid = ('public.' || t)::regclass and conname = t || '_user_id_present') then
      execute format('alter table public.%I add constraint %I check (user_id is not null) not valid', t, t || '_user_id_present');
    end if;
  end loop;
end $$;

-- Columns added by earlier migrations, repeated defensively.
alter table public.jobs add column if not exists pricing_type text not null default 'hourly';
alter table public.jobs add column if not exists half_day_rate numeric;
alter table public.jobs add column if not exists full_day_rate numeric;
alter table public.sessions add column if not exists day_type text;
alter table public.company_profiles add column if not exists half_day_rate numeric;
alter table public.company_profiles add column if not exists full_day_rate numeric;

-- Breaks are stored separately from the actual start/end timestamps.
alter table public.sessions add column if not exists break_seconds integer not null default 0;
alter table public.sessions add column if not exists break_started_at timestamptz;
-- Rate snapshot taken when the session is recorded, so later job or wage
-- changes do not rewrite history. NULL means "legacy row, no snapshot".
alter table public.sessions add column if not exists bill_basis text;
alter table public.sessions add column if not exists bill_rate numeric(12,2);
alter table public.sessions add column if not exists cost_rate numeric(12,2);

alter table public.invoices add column if not exists subtotal numeric(12,2);
alter table public.invoices add column if not exists tax_rate numeric(6,3);
alter table public.invoices add column if not exists tax_amount numeric(12,2);
alter table public.invoices add column if not exists calculated_total numeric(12,2);
alter table public.invoices add column if not exists issued_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_end_after_start') then
    alter table public.sessions add constraint sessions_end_after_start
      check (end_time is null or end_time > start_time) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_break_nonnegative') then
    alter table public.sessions add constraint sessions_break_nonnegative
      check (break_seconds >= 0 and (end_time is null or break_seconds <= extract(epoch from (end_time - start_time)))) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_bill_basis_valid') then
    alter table public.sessions add constraint sessions_bill_basis_valid
      check (bill_basis is null or bill_basis in ('hourly', 'half_day', 'full_day')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_rates_nonnegative') then
    alter table public.sessions add constraint sessions_rates_nonnegative
      check ((bill_rate is null or bill_rate >= 0) and (cost_rate is null or cost_rate >= 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_status_valid') then
    alter table public.invoices add constraint invoices_status_valid
      check (status in ('paid', 'unpaid')) not valid;
  end if;
end $$;

-- One company profile per account. Skipped (with a notice) if duplicates
-- already exist; see docs/DATABASE.md for how to reconcile them.
do $$
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.company_profiles'::regclass and i.indisunique
      and i.indnkeyatts = 1
      and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'public.company_profiles'::regclass and attname = 'user_id')
  ) then
    if exists (select 1 from public.company_profiles group by user_id having count(*) > 1) then
      raise notice 'company_profiles has duplicate rows per user; unique index NOT created. The app now reads the most recently updated row.';
    else
      create unique index company_profiles_user_id_key on public.company_profiles (user_id);
    end if;
  end if;
end $$;

create index if not exists sessions_user_start_idx on public.sessions (user_id, start_time);
create index if not exists sessions_user_active_idx on public.sessions (user_id) where end_time is null;

-------------------------------------------------------------------------------
-- 3. Row housekeeping triggers
-------------------------------------------------------------------------------
create or replace function public.sl_row_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := 1;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.sl_row_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id cannot be changed' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'ownership (user_id) cannot be changed' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- Generic same-owner check for references. Arguments are pairs
-- 'column:parent_table'. Runs as the caller, so under RLS the parent lookup
-- only sees the caller's rows; the explicit user_id match also covers
-- service-role writes.
create or replace function public.sl_check_refs() returns trigger
language plpgsql set search_path = '' as $$
declare
  arg text;
  v_col text;
  v_parent text;
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_ref text;
  v_ok boolean;
begin
  foreach arg in array tg_argv loop
    v_col := split_part(arg, ':', 1);
    v_parent := split_part(arg, ':', 2);
    v_ref := v_new ->> v_col;
    if v_ref is null then continue; end if;
    if tg_op = 'UPDATE' and v_ref is not distinct from (v_old ->> v_col) and new.user_id is not distinct from old.user_id then
      continue;
    end if;
    execute format('select exists (select 1 from public.%I p where p.id = $1 and p.user_id = $2)', v_parent)
      into v_ok using v_ref::uuid, new.user_id;
    if not v_ok then
      raise exception '% % does not belong to this account', v_col, v_ref using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['jobs','sessions','employees','mileage','customers','company_profiles','expenses','invoices'] loop
    execute format('drop trigger if exists sl_row_insert on public.%I', t);
    execute format('create trigger sl_row_insert before insert on public.%I for each row execute function public.sl_row_insert()', t);
    execute format('drop trigger if exists sl_row_update on public.%I', t);
    execute format('create trigger sl_row_update before update on public.%I for each row execute function public.sl_row_update()', t);
  end loop;
end $$;

drop trigger if exists sl_check_refs on public.sessions;
create trigger sl_check_refs before insert or update on public.sessions
  for each row execute function public.sl_check_refs('job_id:jobs', 'employee_id:employees', 'invoice_id:invoices');
drop trigger if exists sl_check_refs on public.mileage;
create trigger sl_check_refs before insert or update on public.mileage
  for each row execute function public.sl_check_refs('job_id:jobs');
drop trigger if exists sl_check_refs on public.expenses;
create trigger sl_check_refs before insert or update on public.expenses
  for each row execute function public.sl_check_refs('job_id:jobs');
drop trigger if exists sl_check_refs on public.invoices;
create trigger sl_check_refs before insert or update on public.invoices
  for each row execute function public.sl_check_refs('customer_id:customers');

-- Billing claims only through record_invoice(): a direct UPDATE may release a
-- session (invoice_id -> NULL, e.g. by deleting the invoice) but may not
-- assign or move one.
create or replace function public.sl_guard_session_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.invoice_id is not null
     and new.invoice_id is distinct from (case when tg_op = 'UPDATE' then old.invoice_id end)
     and coalesce(current_setting('sl.claiming_invoice', true), '') <> new.invoice_id::text then
    raise exception 'sessions can only be billed through record_invoice()' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists sl_guard_session_billing on public.sessions;
create trigger sl_guard_session_billing before insert or update of invoice_id on public.sessions
  for each row execute function public.sl_guard_session_billing();

-- Deleting a job must not silently delete hours that were already billed.
create or replace function public.sl_guard_job_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Only app users are stopped; account deletion by an admin still cascades.
  if current_user <> 'authenticated' then
    return old;
  end if;
  if exists (select 1 from public.sessions s where s.job_id = old.id and s.invoice_id is not null) then
    raise exception 'this job has billed hours; mark it complete or archived instead of deleting it' using errcode = '23503';
  end if;
  return old;
end $$;
drop trigger if exists sl_guard_job_delete on public.jobs;
create trigger sl_guard_job_delete before delete on public.jobs
  for each row execute function public.sl_guard_job_delete();

-- Issued invoices keep their financial details. Only status may change.
create or replace function public.sl_guard_invoice_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.issued_at is not null and (
       new.customer_id is distinct from old.customer_id
    or new.customer_name is distinct from old.customer_name
    or new.amount is distinct from old.amount
    or new.subtotal is distinct from old.subtotal
    or new.tax_rate is distinct from old.tax_rate
    or new.tax_amount is distinct from old.tax_amount
    or new.calculated_total is distinct from old.calculated_total
    or new.date_generated is distinct from old.date_generated
    or new.date_range_start is distinct from old.date_range_start
    or new.date_range_end is distinct from old.date_range_end
    or new.notes is distinct from old.notes
    or new.issued_at is distinct from old.issued_at) then
    raise exception 'issued invoices cannot be changed; only status can be updated' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists sl_guard_invoice_update on public.invoices;
create trigger sl_guard_invoice_update before update on public.invoices
  for each row execute function public.sl_guard_invoice_update();

-------------------------------------------------------------------------------
-- 4. Invoice lines (immutable snapshot of what was billed)
-------------------------------------------------------------------------------
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  line_no integer not null,
  work_date date,
  description text not null default '',
  worker_name text,
  quantity numeric(10,2) not null check (quantity >= 0),
  unit text not null check (unit in ('hour', 'half_day', 'full_day')),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, line_no)
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index if not exists invoice_lines_session_idx on public.invoice_lines (session_id);

create or replace function public.sl_guard_invoice_line_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.invoices i where i.id = new.invoice_id and i.user_id = new.user_id) then
    raise exception 'invoice % does not belong to this account', new.invoice_id using errcode = '42501';
  end if;
  if exists (select 1 from public.invoices i where i.id = new.invoice_id and i.issued_at is not null) then
    raise exception 'issued invoices cannot gain new lines' using errcode = '42501';
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.user_id = new.user_id) then
    raise exception 'session % does not belong to this account', new.session_id using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists sl_guard_invoice_line_insert on public.invoice_lines;
create trigger sl_guard_invoice_line_insert before insert on public.invoice_lines
  for each row execute function public.sl_guard_invoice_line_insert();

-------------------------------------------------------------------------------
-- 5. Voice usage (server-side quota before paid API calls)
-------------------------------------------------------------------------------
create table if not exists public.voice_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_bytes integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists voice_usage_user_time_idx on public.voice_usage (user_id, created_at);

-------------------------------------------------------------------------------
-- 6. RLS: replace all policies on user-owned tables with owner-only policies
-------------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['jobs','sessions','employees','mileage','customers','company_profiles','expenses','invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', 'sl_owner_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', 'sl_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', 'sl_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', 'sl_owner_delete', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- invoice_lines: read and insert own rows; no update/delete (removed only
  -- by deleting the invoice).
  alter table public.invoice_lines enable row level security;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'invoice_lines' loop
    execute format('drop policy %I on public.invoice_lines', p.policyname);
  end loop;
  create policy sl_owner_select on public.invoice_lines for select to authenticated using (user_id = (select auth.uid()));
  create policy sl_owner_insert on public.invoice_lines for insert to authenticated with check (user_id = (select auth.uid()));
  revoke all on public.invoice_lines from anon, public;
  revoke update, delete, truncate on public.invoice_lines from authenticated;
  grant select, insert on public.invoice_lines to authenticated;

  -- voice_usage: users may read their own usage; writes only via the quota function.
  alter table public.voice_usage enable row level security;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'voice_usage' loop
    execute format('drop policy %I on public.voice_usage', p.policyname);
  end loop;
  create policy sl_owner_select on public.voice_usage for select to authenticated using (user_id = (select auth.uid()));
  revoke all on public.voice_usage from anon, public, authenticated;
  grant select on public.voice_usage to authenticated;
end $$;

-------------------------------------------------------------------------------
-- 7. Functions
-------------------------------------------------------------------------------

-- Lets the app check that the server has this migration before syncing
-- columns that only exist after it.
create or replace function public.ledger_schema_version() returns integer
language sql stable security invoker set search_path = '' as $$ select 2 $$;

-- Atomically records an invoice and claims its sessions. SECURITY INVOKER, so
-- RLS applies to every statement; ownership is also checked explicitly.
-- Idempotent: retrying with the same invoice id and the same sessions returns
-- the stored invoice instead of creating a second one.
create or replace function public.record_invoice(p_invoice jsonb, p_session_ids uuid[], p_lines jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_n integer := coalesce(array_length(p_session_ids, 1), 0);
  v_existing public.invoices;
  v_found integer;
  v_billed integer;
  v_open integer;
  v_claimed integer;
  v_subtotal numeric(12,2);
  v_tax_rate numeric(6,3);
  v_tax numeric(12,2);
  v_calc numeric(12,2);
  v_amount numeric(12,2);
  v_bad integer;
  v_result public.invoices;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  begin
    v_id := (p_invoice ->> 'id')::uuid;
  exception when others then
    raise exception 'invoice id must be a uuid' using errcode = '22023';
  end;
  if v_id is null then
    raise exception 'invoice id is required' using errcode = '22023';
  end if;
  if v_n = 0 then
    raise exception 'select at least one entry to bill' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_session_ids) x) <> v_n then
    raise exception 'duplicate entries in request' using errcode = '22023';
  end if;

  -- Replay of a request that already succeeded (e.g. the response was lost).
  select * into v_existing from public.invoices where id = v_id;
  if found then
    select count(*) into v_found from public.sessions where invoice_id = v_id;
    select count(*) into v_claimed from public.sessions where invoice_id = v_id and id = any(p_session_ids);
    if v_found = v_n and v_claimed = v_n then
      return jsonb_build_object(
        'invoice', to_jsonb(v_existing),
        'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.invoice_lines l where l.invoice_id = v_id), '[]'::jsonb),
        'replayed', true);
    end if;
    raise exception 'this invoice request was already used with different entries' using errcode = '23505';
  end if;

  -- Lock the requested sessions so concurrent requests serialize here.
  perform 1 from public.sessions where id = any(p_session_ids) and user_id = v_uid for update;
  select count(*),
         count(*) filter (where invoice_id is not null),
         count(*) filter (where end_time is null)
    into v_found, v_billed, v_open
    from public.sessions where id = any(p_session_ids) and user_id = v_uid;
  if v_found <> v_n then
    raise exception '% of % entries were not found on the server (not synced yet, deleted, or not yours)', v_n - v_found, v_n using errcode = 'P0002';
  end if;
  if v_billed > 0 then
    raise exception '% entries are already billed on another invoice', v_billed using errcode = '40001';
  end if;
  if v_open > 0 then
    raise exception 'cannot bill a session that is still clocked in' using errcode = '22023';
  end if;

  -- Validate lines: exactly one per session, arithmetic consistent.
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> v_n then
    raise exception 'expected one invoice line per entry' using errcode = '22023';
  end if;
  select count(*) into v_bad from (
    select (l ->> 'session_id')::uuid sid from jsonb_array_elements(p_lines) l
  ) x where x.sid is null or not (x.sid = any(p_session_ids));
  if v_bad > 0 or (select count(distinct (l ->> 'session_id')) from jsonb_array_elements(p_lines) l) <> v_n then
    raise exception 'invoice lines must match the selected entries one-to-one' using errcode = '22023';
  end if;
  select count(*) into v_bad from jsonb_array_elements(p_lines) l
   where (l ->> 'quantity')::numeric < 0 or (l ->> 'unit_price')::numeric < 0
      or (l ->> 'amount')::numeric(12,2) <> round((l ->> 'quantity')::numeric(10,2) * (l ->> 'unit_price')::numeric(12,2), 2)
      or (l ->> 'unit') not in ('hour', 'half_day', 'full_day');
  if v_bad > 0 then
    raise exception 'invoice line amounts must equal quantity x unit price, rounded to cents' using errcode = '22023';
  end if;

  v_subtotal := (select sum((l ->> 'amount')::numeric(12,2)) from jsonb_array_elements(p_lines) l);
  v_tax_rate := coalesce((p_invoice ->> 'tax_rate')::numeric(6,3), 0);
  if v_tax_rate < 0 or v_tax_rate > 100 then
    raise exception 'tax rate must be between 0 and 100' using errcode = '22023';
  end if;
  v_tax := round(v_subtotal * v_tax_rate / 100, 2);
  v_calc := v_subtotal + v_tax;
  if (p_invoice ->> 'subtotal')::numeric(12,2) is distinct from v_subtotal
     or (p_invoice ->> 'tax_amount')::numeric(12,2) is distinct from v_tax
     or (p_invoice ->> 'calculated_total')::numeric(12,2) is distinct from v_calc then
    raise exception 'invoice totals do not match the lines (subtotal %, tax %, total %)', v_subtotal, v_tax, v_calc using errcode = '22023';
  end if;
  v_amount := coalesce((p_invoice ->> 'amount')::numeric(12,2), v_calc);
  if v_amount < 0 then
    raise exception 'amount must not be negative' using errcode = '22023';
  end if;

  insert into public.invoices (id, user_id, customer_id, customer_name, amount, status,
                               date_generated, date_range_start, date_range_end, notes,
                               subtotal, tax_rate, tax_amount, calculated_total)
  values (v_id, v_uid,
          nullif(p_invoice ->> 'customer_id', '')::uuid,
          coalesce(p_invoice ->> 'customer_name', ''),
          v_amount,
          coalesce(nullif(p_invoice ->> 'status', ''), 'unpaid'),
          (p_invoice ->> 'date_generated')::date,
          (p_invoice ->> 'date_range_start')::date,
          (p_invoice ->> 'date_range_end')::date,
          p_invoice ->> 'notes',
          v_subtotal, v_tax_rate, v_tax, v_calc);

  insert into public.invoice_lines (user_id, invoice_id, session_id, line_no, work_date, description,
                                    worker_name, quantity, unit, unit_price, amount)
  select v_uid, v_id, (l ->> 'session_id')::uuid, (row_number() over ())::integer,
         (l ->> 'work_date')::date, coalesce(l ->> 'description', ''), l ->> 'worker_name',
         (l ->> 'quantity')::numeric(10,2), l ->> 'unit', (l ->> 'unit_price')::numeric(12,2),
         (l ->> 'amount')::numeric(12,2)
    from jsonb_array_elements(p_lines) l;

  perform set_config('sl.claiming_invoice', v_id::text, true);
  update public.sessions set invoice_id = v_id
   where id = any(p_session_ids) and user_id = v_uid and invoice_id is null;
  get diagnostics v_claimed = row_count;
  perform set_config('sl.claiming_invoice', '', true);
  if v_claimed <> v_n then
    raise exception 'could only claim % of % entries; nothing was recorded', v_claimed, v_n using errcode = '40001';
  end if;

  update public.invoices set issued_at = now() where id = v_id returning * into v_result;

  return jsonb_build_object(
    'invoice', to_jsonb(v_result),
    'lines', (select jsonb_agg(to_jsonb(l) order by l.line_no) from public.invoice_lines l where l.invoice_id = v_id),
    'replayed', false);
end $$;

-- Per-user voice quota. SECURITY DEFINER because users must not be able to
-- write or delete their own usage rows; it only ever acts on auth.uid().
create or replace function public.consume_voice_quota(p_audio_bytes integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hour integer;
  v_day integer;
  c_per_hour constant integer := 30;
  c_per_day constant integer := 120;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_audio_bytes is null or p_audio_bytes < 0 or p_audio_bytes > 10 * 1024 * 1024 then
    raise exception 'invalid audio size' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));
  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hour, v_day
    from public.voice_usage where user_id = v_uid and created_at > now() - interval '1 day';
  if v_hour >= c_per_hour or v_day >= c_per_day then
    return jsonb_build_object('allowed', false, 'used_last_hour', v_hour, 'used_last_day', v_day);
  end if;
  insert into public.voice_usage (user_id, audio_bytes) values (v_uid, p_audio_bytes);
  return jsonb_build_object('allowed', true, 'used_last_hour', v_hour + 1, 'used_last_day', v_day + 1);
end $$;

-- Least-privilege execute grants. Supabase grants EXECUTE to anon and
-- authenticated by default, so revoke explicitly.
do $$
declare f text;
begin
  foreach f in array array[
    'public.sl_row_insert()', 'public.sl_row_update()', 'public.sl_check_refs()',
    'public.sl_guard_session_billing()', 'public.sl_guard_job_delete()',
    'public.sl_guard_invoice_update()', 'public.sl_guard_invoice_line_insert()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.ledger_schema_version() from public, anon;
grant execute on function public.ledger_schema_version() to authenticated;
revoke all on function public.record_invoice(jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.record_invoice(jsonb, uuid[], jsonb) to authenticated;
revoke all on function public.consume_voice_quota(integer) from public, anon, authenticated;
grant execute on function public.consume_voice_quota(integer) to authenticated;

notify pgrst, 'reload schema';
