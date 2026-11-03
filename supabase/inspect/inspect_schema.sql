-- READ-ONLY inspection of the live Site Ledger schema and access policies.
-- Returns metadata and counts only; it never selects customer records.
-- Run in the Supabase SQL editor (or psql) BEFORE applying
-- 20261103120000_security_and_sync_hardening.sql, and save the output.
--   psql "$DATABASE_URL" -X -f supabase/inspect/inspect_schema.sql > inspect-before.txt
set transaction read only;

\echo '== 1. Tables, RLS flags'
select c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;

\echo '== 2. Column types (id/user_id must be uuid for the migration to proceed)'
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('jobs','sessions','employees','mileage','customers','company_profiles','expenses','invoices')
order by table_name, ordinal_position;

\echo '== 3. Existing policies (all of these are replaced by the migration)'
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

\echo '== 4. Table privileges for anon / authenticated'
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
group by table_name, grantee order by table_name, grantee;

\echo '== 5. Foreign keys and their ON DELETE behaviour'
select conrelid::regclass as table, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace order by 1, 2;

\echo '== 6. Unique constraints / indexes'
select indrelid::regclass as table, indexrelid::regclass as index, pg_get_indexdef(indexrelid) as definition
from pg_index where indisunique and indrelid::regclass::text not like 'pg_%'
  and indrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) order by 1;

\echo '== 7. Functions in public (SECURITY DEFINER ones need review)'
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       case when p.prosecdef then 'DEFINER' else 'invoker' end as security,
       p.proconfig as settings, p.proacl as acl
from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1;

\echo '== 8. Triggers'
select event_object_table as table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public' order by 1, 2;

\echo '== 9. Data-shape checks (counts only)'
select 'rows with null user_id' as check, t, n from (
  select 'jobs' t, count(*) n from public.jobs where user_id is null union all
  select 'sessions', count(*) from public.sessions where user_id is null union all
  select 'employees', count(*) from public.employees where user_id is null union all
  select 'mileage', count(*) from public.mileage where user_id is null union all
  select 'customers', count(*) from public.customers where user_id is null union all
  select 'company_profiles', count(*) from public.company_profiles where user_id is null union all
  select 'expenses', count(*) from public.expenses where user_id is null union all
  select 'invoices', count(*) from public.invoices where user_id is null) x;
select 'accounts with >1 company profile' as check, count(*) from (
  select user_id from public.company_profiles group by user_id having count(*) > 1) x;
select 'sessions referencing another account''s job' as check, count(*)
  from public.sessions s join public.jobs j on j.id = s.job_id where j.user_id is distinct from s.user_id;
select 'sessions referencing another account''s employee' as check, count(*)
  from public.sessions s join public.employees e on e.id = s.employee_id where e.user_id is distinct from s.user_id;
select 'sessions with end <= start' as check, count(*) from public.sessions where end_time <= start_time;
select 'accounts with more than one open session' as check, count(*) from (
  select user_id from public.sessions where end_time is null group by user_id having count(*) > 1) x;
select 'distinct accounts' as check, count(distinct user_id) from public.sessions;

\echo '== 10. Historical backfill footprint (Billed before Oct 25, 2026)'
select count(distinct i.user_id) as accounts_with_backfill_record, count(distinct i.id) as backfill_records,
       count(s.id) as sessions_claimed
from public.invoices i left join public.sessions s on s.invoice_id = i.id
where i.notes = 'Billed before Oct 25, 2026';

\echo '== 11. Applied migrations (if tracked by the Supabase CLI)'
select to_regclass('supabase_migrations.schema_migrations') is not null as has_migrations \gset
\if :has_migrations
select version, name from supabase_migrations.schema_migrations order by version;
\else
\echo '(no supabase_migrations table)'
\endif
