-- Two-account isolation tests. Synthetic data only. Runs in one transaction
-- and rolls back.
begin;

select tests.as_superuser();
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');

-- Account A creates one row in every table.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.jobs (id, name, rate) values ('a0000000-0000-0000-0000-00000000000a', 'A job', 65);
insert into public.employees (id, name, rate) values ('a0000000-0000-0000-0000-0000000000e1', 'A worker', 40);
insert into public.customers (id, name) values ('a0000000-0000-0000-0000-0000000000c1', 'A customer');
insert into public.sessions (id, job_id, employee_id, start_time, end_time)
  values ('a0000000-0000-0000-0000-000000000051', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000e1',
          '2026-10-01 08:00-07', '2026-10-01 16:00-07');
insert into public.mileage (job_id, date, km) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-01', 42);
insert into public.expenses (job_id, date, description, amount) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-01', 'lumber', 120);
insert into public.company_profiles (name) values ('A Co');

select tests.assert((select user_id from public.jobs where id = 'a0000000-0000-0000-0000-00000000000a') = 'aaaaaaaa-0000-0000-0000-000000000001',
  'user_id defaults to auth.uid()');
select tests.assert((select version from public.jobs where id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'insert sets version 1');
insert into public.expenses (job_id, date, description, amount, category) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-02', 'screws', 9, 'materials');
select tests.assert((select category from public.expenses where description = 'screws') = 'materials', 'expenses.category exists after migration');

-- Account B sees nothing of A's, in any table.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select tests.assert((select count(*) from public.jobs) = 0, 'B cannot SELECT A jobs (stray permissive policy removed)');
select tests.assert((select count(*) from public.sessions) = 0, 'B cannot SELECT A sessions');
select tests.assert((select count(*) from public.employees) = 0, 'B cannot SELECT A employees');
select tests.assert((select count(*) from public.customers) = 0, 'B cannot SELECT A customers');
select tests.assert((select count(*) from public.mileage) = 0, 'B cannot SELECT A mileage');
select tests.assert((select count(*) from public.expenses) = 0, 'B cannot SELECT A expenses');
select tests.assert(tests.rows_affected($$update public.expenses set amount = 1$$) = 0, 'B cannot UPDATE A expenses');
select tests.assert(tests.rows_affected($$update public.invoices set amount = 1$$) = 0, 'B cannot UPDATE A invoices');
select tests.assert((select count(*) from public.company_profiles) = 0, 'B cannot SELECT A company profile');
select tests.assert((select count(*) from public.invoices) = 0, 'B cannot SELECT A invoices');

-- B cannot UPDATE or DELETE A's rows.
select tests.assert(tests.rows_affected($$update public.jobs set rate = 1 where id = 'a0000000-0000-0000-0000-00000000000a'$$) = 0, 'B cannot UPDATE A job');
select tests.assert(tests.rows_affected($$update public.sessions set notes = 'x'$$) = 0, 'B cannot UPDATE A sessions');
select tests.assert(tests.rows_affected($$delete from public.expenses$$) = 0, 'B cannot DELETE A expenses');
select tests.assert(tests.rows_affected($$delete from public.jobs$$) = 0, 'B cannot DELETE A jobs');

-- B cannot INSERT rows owned by A.
select tests.assert_error($$insert into public.jobs (user_id, name, rate) values ('aaaaaaaa-0000-0000-0000-000000000001', 'forged', 1)$$,
  '42501', 'B cannot INSERT a row with A as owner');

-- B cannot attach its own rows to A's jobs/employees/customers by id.
insert into public.jobs (id, name, rate) values ('b0000000-0000-0000-0000-00000000000b', 'B job', 50);
select tests.assert_error($$insert into public.sessions (job_id, start_time, end_time) values ('a0000000-0000-0000-0000-00000000000a', now() - interval '1 hour', now())$$,
  '42501', 'B session cannot reference A job');
select tests.assert_error($$insert into public.sessions (job_id, employee_id, start_time) values ('b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000e1', now())$$,
  '42501', 'B session cannot reference A employee');
select tests.assert_error($$insert into public.mileage (job_id, date, km) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-02', 5)$$,
  '42501', 'B mileage cannot reference A job');
select tests.assert_error($$insert into public.expenses (job_id, date, amount) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-02', 5)$$,
  '42501', 'B expense cannot reference A job');
select tests.assert_error($$insert into public.invoices (customer_id, amount, status) values ('a0000000-0000-0000-0000-0000000000c1', 1, 'unpaid')$$,
  '42501', 'B invoice cannot reference A customer');
insert into public.sessions (id, job_id, start_time, end_time)
  values ('b0000000-0000-0000-0000-000000000051', 'b0000000-0000-0000-0000-00000000000b', now() - interval '2 hour', now() - interval '1 hour');
select tests.assert_error($$update public.sessions set job_id = 'a0000000-0000-0000-0000-00000000000a' where id = 'b0000000-0000-0000-0000-000000000051'$$,
  '42501', 'B cannot re-point its session to A job');

-- Ownership cannot be changed by UPDATE (RLS WITH CHECK + trigger).
select tests.assert_error($$update public.jobs set user_id = 'aaaaaaaa-0000-0000-0000-000000000001' where id = 'b0000000-0000-0000-0000-00000000000b'$$,
  '42501', 'B cannot give its job to A');
select tests.as_superuser();
select tests.assert_error($$update public.jobs set user_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = 'a0000000-0000-0000-0000-00000000000a'$$,
  '42501', 'even privileged roles cannot silently move ownership');

-- Version increments on every update.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.jobs set rate = 70 where id = 'a0000000-0000-0000-0000-00000000000a';
select tests.assert((select version from public.jobs where id = 'a0000000-0000-0000-0000-00000000000a') = 2, 'update bumps version');
-- Clients cannot fake the version.
update public.jobs set version = 99, rate = 71 where id = 'a0000000-0000-0000-0000-00000000000a';
select tests.assert((select version from public.jobs where id = 'a0000000-0000-0000-0000-00000000000a') = 3, 'client cannot set version');
-- Version-checked update affects 0 rows when stale (used for conflict detection).
select tests.assert(tests.rows_affected($$update public.jobs set rate = 72 where id = 'a0000000-0000-0000-0000-00000000000a' and version = 2$$) = 0,
  'stale version update affects no rows');

-- Sessions cannot be billed by a direct UPDATE.
insert into public.invoices (id, amount, status) values ('a0000000-0000-0000-0000-0000000000f1', 0, 'unpaid');
select tests.assert_error($$update public.sessions set invoice_id = 'a0000000-0000-0000-0000-0000000000f1'$$,
  '42501', 'billing only via record_invoice');

-- Session validation.
select tests.assert_error($$insert into public.sessions (job_id, start_time, end_time) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-02 10:00-07', '2026-10-02 09:00-07')$$,
  '23514', 'end must be after start');
select tests.assert_error($$insert into public.sessions (job_id, start_time, end_time, break_seconds) values ('a0000000-0000-0000-0000-00000000000a', '2026-10-02 09:00-07', '2026-10-02 10:00-07', 7200)$$,
  '23514', 'break cannot exceed session');

-- Unauthenticated requests see and change nothing.
select tests.as_anon();
select tests.assert_error($$select count(*) from public.jobs$$, '42501', 'anon has no table privileges');
select tests.assert_error($$insert into public.jobs (name, rate) values ('anon', 1)$$, '42501', 'anon cannot insert');
select tests.assert_error($$select public.record_invoice('{}'::jsonb, '{}'::uuid[], '[]'::jsonb)$$, '42501', 'anon cannot call record_invoice');
select tests.assert_error($$select public.consume_voice_quota(10)$$, '42501', 'anon cannot call consume_voice_quota');
select tests.assert_error($$select count(*) from public.invoice_lines$$, '42501', 'anon cannot read invoice_lines');

-- Authenticated without a sub claim (malformed token) sees nothing.
select tests.as_superuser();
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select tests.assert((select count(*) from public.jobs) = 0, 'no sub claim -> no rows');

-- Deleting a job with billed hours is refused (guards against cascade loss).
-- (Covered with a real claim in 20_invoices.sql.)

-- Every user-owned table has RLS enabled.
select tests.as_superuser();
select tests.assert(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('jobs','sessions','employees','mileage','customers','company_profiles','expenses','invoices','invoice_lines','voice_usage')
    and not c.relrowsecurity), 'RLS enabled on every user-owned table');
-- No policy grants anything to anon/public.
select tests.assert(not exists (
  select 1 from pg_policies where schemaname = 'public'
    and (roles && array['anon','public']::name[])), 'no policies for anon/public');

select 'rls_isolation: all assertions passed' as result;
rollback;
