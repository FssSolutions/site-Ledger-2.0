-- Site Ledger: QuickBooks Online connection (docs/QUICKBOOKS_PLAN.md, phase 1,
-- step 1: connect / disconnect only).
--
-- What this migration does:
--   1. Adds qbo_connections: one row per account holding the QuickBooks
--      company id and the ENCRYPTED OAuth tokens. The tokens can read and
--      write the user's books, so app users get no access to this table at
--      all; only the Edge Functions (service role) read and write it.
--   2. Adds qbo_oauth_states: short-lived, single-use sign-in states that tie
--      Intuit's redirect back to the account that started it.
--   3. Adds qbo_status(): the only thing the app can read. It returns the
--      caller's connection status and company name, never tokens.
--
-- Additive only: no existing table, row, policy or function is changed, and
-- ledger_schema_version() is not bumped (older app builds are unaffected).
-- Safe to re-run.

-------------------------------------------------------------------------------
-- 1. Tables
-------------------------------------------------------------------------------
create table if not exists public.qbo_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- QuickBooks company id ("realm").
  realm_id text not null,
  environment text not null check (environment in ('sandbox', 'production')),
  -- AES-GCM ciphertext; the key lives only in Edge Function secrets.
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  company_name text,
  country text,
  -- Chosen during setup (a later step): the QuickBooks items and tax code
  -- used on invoice lines. They belong to one QuickBooks company.
  labour_item_id text,
  half_day_item_id text,
  full_day_item_id text,
  tax_code_id text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One SiteLedger account per QuickBooks company, so a change reported by
-- QuickBooks can always be routed to exactly one account.
create unique index if not exists qbo_connections_realm_key
  on public.qbo_connections (environment, realm_id);

create table if not exists public.qbo_oauth_states (
  -- SHA-256 of the random state sent to Intuit; the raw value is never stored.
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists qbo_oauth_states_user_idx on public.qbo_oauth_states (user_id);

-------------------------------------------------------------------------------
-- 2. Access: nothing for app users
-------------------------------------------------------------------------------
-- RLS is on with NO policies, and every privilege is revoked, so anon and
-- authenticated can neither read nor write these tables. The service role
-- (Edge Functions only) bypasses RLS.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['qbo_connections', 'qbo_oauth_states'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 3. Status for the app
-------------------------------------------------------------------------------
-- SECURITY DEFINER because the caller cannot read qbo_connections. It only
-- ever looks at auth.uid() and returns no token material.
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
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object(
    'connected', true,
    'status', v_row.status,
    'company_name', v_row.company_name,
    'environment', v_row.environment,
    'connected_at', v_row.connected_at,
    'setup_complete', v_row.labour_item_id is not null and v_row.tax_code_id is not null);
end $$;

revoke all on function public.qbo_status() from public, anon, authenticated;
grant execute on function public.qbo_status() to authenticated;

notify pgrst, 'reload schema';
