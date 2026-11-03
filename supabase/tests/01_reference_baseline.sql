-- TEST-ONLY copy of the production table structure, rebuilt from the
-- read-only inspection of production on 2026-11-03 (column names, uuid key
-- types, foreign keys and their ON DELETE actions, and the existing RLS
-- policies). Column types other than the key columns, defaults and NOT NULL
-- settings were not inspected and are reasonable guesses. Never apply this
-- file to a real project.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text not null,
  rate numeric,
  color text,
  created_at timestamptz not null default now(),
  notes text,
  status text default 'active',
  address text,
  budget_hours numeric,
  budget_cost numeric
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
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
  user_id uuid references auth.users(id),
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric,
  date_issued date,
  period_start date,
  period_end date,
  status text default 'unpaid',
  notes text,
  created_at timestamptz not null default now(),
  customer_name text,
  date_generated date,
  date_range_start date,
  date_range_end date
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  job_id uuid references public.jobs(id),
  start_time timestamptz not null,
  end_time timestamptz,
  created_at timestamptz not null default now(),
  employee_id uuid references public.employees(id),
  notes text
);

create table public.mileage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  job_id uuid references public.jobs(id),
  date date not null,
  km numeric not null,
  note text,
  created_at timestamptz not null default now()
);

-- Production has no expenses.category (the hardening migration adds it).
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  job_id uuid references public.jobs(id) on delete set null,
  date date not null,
  description text,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text, phone text, email text, address text,
  gst_number text, worksafe_number text, logo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- Production policies as inspected (role "public", some duplicated, some
-- without WITH CHECK).
alter table public.jobs enable row level security;
create policy "Users manage own jobs" on public.jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jobs_user" on public.jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.sessions enable row level security;
create policy "Users manage own sessions" on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sessions_user" on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.employees enable row level security;
create policy "Users manage own employees" on public.employees for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "emp_user" on public.employees for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.mileage enable row level security;
create policy "Users manage own mileage" on public.mileage for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mil_user" on public.mileage for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.customers enable row level security;
create policy "Users see own customers" on public.customers for select using (auth.uid() = user_id);
create policy "Users insert own customers" on public.customers for insert with check (auth.uid() = user_id);
create policy "Users update own customers" on public.customers for update using (auth.uid() = user_id);
create policy "Users delete own customers" on public.customers for delete using (auth.uid() = user_id);
alter table public.company_profiles enable row level security;
create policy "select own" on public.company_profiles for select using (auth.uid() = user_id);
create policy "insert own" on public.company_profiles for insert with check (auth.uid() = user_id);
create policy "update own" on public.company_profiles for update using (auth.uid() = user_id);
alter table public.expenses enable row level security;
create policy "user expenses" on public.expenses for all using (auth.uid() = user_id);
alter table public.invoices enable row level security;
create policy "user invoices" on public.invoices for all using (auth.uid() = user_id);

-- TEST-ONLY ADDITION (not in production): a stray permissive policy, to prove
-- the migration removes policies it does not know about.
create policy "stray permissive read" on public.jobs for select using (true);
