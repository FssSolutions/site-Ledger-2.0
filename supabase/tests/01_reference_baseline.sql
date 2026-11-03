-- TEST-ONLY APPROXIMATION of the legacy base tables.
--
-- The production tables were created outside this repository (no baseline
-- migration exists), so this file is reconstructed from the columns the app
-- reads and writes. It is NOT a description of production and must never be
-- applied to a real project. Run supabase/inspect/inspect_schema.sql (read-only)
-- against production to compare.
--
-- It deliberately includes weaknesses the hardening migration must remove:
--   * a permissive "true" SELECT policy on jobs,
--   * RLS disabled on expenses,
--   * an UPDATE policy without WITH CHECK on sessions.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  rate numeric,
  color text,
  notes text,
  status text default 'active',
  address text,
  budget_hours numeric,
  budget_cost numeric,
  created_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  rate numeric,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  phone text, email text, address text,
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  amount numeric,
  status text default 'unpaid',
  date_generated date,
  date_range_start date,
  date_range_end date,
  notes text,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  start_time timestamptz not null,
  end_time timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table public.mileage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  date date not null,
  km numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  date date not null,
  description text,
  amount numeric not null,
  category text,
  created_at timestamptz not null default now()
);

create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text, phone text, email text, address text,
  gst_number text, worksafe_number text, logo text,
  created_at timestamptz not null default now()
);

alter table public.jobs enable row level security;
create policy "Enable read access for all users" on public.jobs for select using (true);
create policy "own jobs write" on public.jobs for all using (auth.uid() = user_id);

alter table public.sessions enable row level security;
create policy "own sessions" on public.sessions for select using (auth.uid() = user_id);
create policy "own sessions insert" on public.sessions for insert with check (auth.uid() = user_id);
create policy "own sessions update" on public.sessions for update using (auth.uid() = user_id);
create policy "own sessions delete" on public.sessions for delete using (auth.uid() = user_id);

do $$
declare t text;
begin
  foreach t in array array['employees','customers','invoices','mileage','company_profiles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
-- expenses intentionally left without RLS.
