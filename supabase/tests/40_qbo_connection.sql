-- QuickBooks connection: app users can never reach the token tables, and
-- qbo_status() only ever reports the caller's own connection, without tokens.
-- Synthetic data only. Runs in one transaction and rolls back.
begin;

select tests.as_superuser();
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');

-- The Edge Functions write as the service role.
set local role service_role;
insert into public.qbo_connections (user_id, realm_id, environment, access_token_enc, refresh_token_enc, access_expires_at, company_name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '4620816365000000001', 'sandbox', 'v1:secret-access', 'v1:secret-refresh', now() + interval '1 hour', 'A Carpentry Ltd.');
insert into public.qbo_oauth_states (state_hash, user_id, expires_at)
  values ('hash-a', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '10 minutes');
select tests.assert((select count(*) from public.qbo_connections) = 1, 'service role can read connections');

-- One SiteLedger account per QuickBooks company.
select tests.assert_error($$insert into public.qbo_connections (user_id, realm_id, environment, access_token_enc, refresh_token_enc, access_expires_at)
  values ('bbbbbbbb-0000-0000-0000-000000000002', '4620816365000000001', 'sandbox', 'x', 'y', now())$$,
  '23505', 'a QuickBooks company cannot be connected to two accounts');

-- The owner cannot touch the tables directly, not even their own row.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.assert_error($$select 1 from public.qbo_connections$$, '42501', 'owner cannot SELECT qbo_connections');
select tests.assert_error($$update public.qbo_connections set status = 'connected'$$, '42501', 'owner cannot UPDATE qbo_connections');
select tests.assert_error($$delete from public.qbo_connections$$, '42501', 'owner cannot DELETE qbo_connections');
select tests.assert_error($$insert into public.qbo_connections (user_id, realm_id, environment, access_token_enc, refresh_token_enc, access_expires_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '1', 'sandbox', 'x', 'y', now())$$, '42501', 'owner cannot INSERT qbo_connections');
select tests.assert_error($$select 1 from public.qbo_oauth_states$$, '42501', 'owner cannot SELECT qbo_oauth_states');
select tests.assert_error($$insert into public.qbo_oauth_states (state_hash, user_id, expires_at)
  values ('forged', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '1 hour')$$, '42501', 'owner cannot forge a sign-in state');

-- Status shows the owner's connection and nothing secret.
select tests.assert((public.qbo_status() ->> 'connected')::boolean, 'owner sees connected');
select tests.assert(public.qbo_status() ->> 'company_name' = 'A Carpentry Ltd.', 'owner sees the company name');
select tests.assert(public.qbo_status() ->> 'environment' = 'sandbox', 'owner sees the environment');
select tests.assert((public.qbo_status() ->> 'setup_complete')::boolean is false, 'setup is not complete before items and tax code are chosen');
select tests.assert(public.qbo_status()::text not like '%secret%', 'status never contains token material');
select tests.assert(not (public.qbo_status() ? 'realm_id'), 'status does not expose the QuickBooks company id');

-- Another account sees only "not connected".
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select tests.assert((public.qbo_status() ->> 'connected')::boolean is false, 'B does not see A''s connection');
select tests.assert_error($$select 1 from public.qbo_connections$$, '42501', 'B cannot SELECT qbo_connections');

-- Signed-out callers get nothing.
select tests.as_anon();
select tests.assert_error($$select public.qbo_status()$$, '42501', 'anon cannot call qbo_status');
select tests.assert_error($$select 1 from public.qbo_connections$$, '42501', 'anon cannot SELECT qbo_connections');

-- Structure: RLS on, and no policy opens the tables to anyone.
select tests.as_superuser();
select tests.assert((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.qbo_connections'::regclass, 'public.qbo_oauth_states'::regclass)), 'RLS enabled on both QuickBooks tables');
select tests.assert(not exists (select 1 from pg_policies where schemaname = 'public'
  and tablename in ('qbo_connections', 'qbo_oauth_states')), 'no policies on the QuickBooks tables');

-- Deleting the account removes its connection and pending sign-in states.
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.assert((select count(*) from public.qbo_connections) = 0, 'connection is removed with the account');
select tests.assert((select count(*) from public.qbo_oauth_states) = 0, 'sign-in states are removed with the account');

select 'qbo_connection: all assertions passed' as result;
rollback;
