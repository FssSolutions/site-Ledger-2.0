-- QuickBooks invoice fields: only the server writes them, the QuickBooks
-- invoice id is write-once, recording an invoice still works, and customer
-- links are closed to app users.
-- Synthetic data only. Runs in one transaction and rolls back.
begin;

select tests.as_superuser();
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');

-- Account A records an invoice the normal way.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.jobs (id, name, rate) values ('a0000000-0000-0000-0000-00000000000a', 'A job', 65);
insert into public.customers (id, name) values ('a0000000-0000-0000-0000-0000000000c1', 'A customer');
insert into public.customers (id, name) values ('a0000000-0000-0000-0000-0000000000c2', 'A customer with no invoices');
insert into public.sessions (id, job_id, start_time, end_time, bill_basis, bill_rate)
  values ('a0000000-0000-0000-0000-000000000051', 'a0000000-0000-0000-0000-00000000000a', '2026-10-01 08:00-07', '2026-10-01 16:00-07', 'hourly', 65);
select public.record_invoice(
  '{"id":"a0000000-0000-0000-0000-0000000000f1","customer_id":"a0000000-0000-0000-0000-0000000000c1","customer_name":"A customer","status":"unpaid","date_generated":"2026-10-02","date_range_start":"2026-10-01","date_range_end":"2026-10-01","notes":"","subtotal":"520.00","tax_rate":5,"tax_amount":"26.00","calculated_total":"546.00","amount":"546.00"}'::jsonb,
  array['a0000000-0000-0000-0000-000000000051']::uuid[],
  '[{"session_id":"a0000000-0000-0000-0000-000000000051","work_date":"2026-10-01","description":"A job","worker_name":null,"quantity":"8.00","unit":"hour","unit_price":"65.00","amount":"520.00"}]'::jsonb);
select tests.assert((select qbo_status is null and qbo_invoice_id is null and qbo_attempt = 0 from public.invoices where id = 'a0000000-0000-0000-0000-0000000000f1'),
  'record_invoice() still works and leaves QuickBooks fields empty');

-- The owner cannot set or change QuickBooks fields.
select tests.assert_error($$update public.invoices set qbo_status = 'created' where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '42501', 'owner cannot set qbo_status');
select tests.assert_error($$update public.invoices set qbo_invoice_id = '999' where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '42501', 'owner cannot set qbo_invoice_id');
select tests.assert_error($$update public.invoices set qbo_total = 1, qbo_balance = 0 where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '42501', 'owner cannot set QuickBooks totals');
select tests.assert_error($$update public.invoices set qbo_attempt = 5 where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '42501', 'owner cannot change qbo_attempt');
select tests.assert_error($$insert into public.invoices (id, customer_name, amount, status, qbo_status, qbo_invoice_id)
  values ('a0000000-0000-0000-0000-0000000000f2', 'x', 1, 'unpaid', 'created', '123')$$, '42501', 'owner cannot insert an invoice that claims to be in QuickBooks');
-- ...but can still change paid status.
select tests.assert(tests.rows_affected($$update public.invoices set status = 'paid' where id = 'a0000000-0000-0000-0000-0000000000f1'$$) = 1, 'owner can still mark an invoice paid');

-- The server (service role) fills them in.
set local role service_role;
update public.invoices set qbo_status = 'pending', qbo_realm_id = '123' where id = 'a0000000-0000-0000-0000-0000000000f1';
update public.invoices set qbo_status = 'failed', qbo_error = 'QuickBooks could not be reached', qbo_attempt = qbo_attempt + 1 where id = 'a0000000-0000-0000-0000-0000000000f1';
update public.invoices set qbo_status = 'created', qbo_invoice_id = '145', qbo_doc_number = '1042', qbo_total = 546.00, qbo_tax = 26.00, qbo_balance = 546.00, qbo_error = null, qbo_synced_at = now()
  where id = 'a0000000-0000-0000-0000-0000000000f1';
select tests.assert((select qbo_invoice_id = '145' and qbo_status = 'created' and qbo_attempt = 1 from public.invoices where id = 'a0000000-0000-0000-0000-0000000000f1'), 'service role can record the QuickBooks result');
select tests.assert_error($$update public.invoices set qbo_invoice_id = '146' where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '42501', 'the QuickBooks invoice id is write-once, even for the server');
select tests.assert_error($$update public.invoices set qbo_status = 'sent' where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '23514', 'unknown qbo_status refused');
-- The server still cannot alter the recorded amounts of an issued invoice.
select tests.assert_error($$update public.invoices set amount = 1 where id = 'a0000000-0000-0000-0000-0000000000f1'$$, '42501', 'issued amounts stay immutable for the server too');

insert into public.qbo_customer_links (customer_id, realm_id, user_id, qbo_customer_id)
  values ('a0000000-0000-0000-0000-0000000000c1', '123', 'aaaaaaaa-0000-0000-0000-000000000001', '58'),
         ('a0000000-0000-0000-0000-0000000000c2', '123', 'aaaaaaaa-0000-0000-0000-000000000001', '59');

-- The owner sees the QuickBooks result on the invoice, but not the links table.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.assert((select qbo_doc_number = '1042' and qbo_total = 546.00 from public.invoices where id = 'a0000000-0000-0000-0000-0000000000f1'), 'owner can read the QuickBooks result');
select tests.assert(tests.rows_affected($$update public.invoices set status = 'unpaid' where id = 'a0000000-0000-0000-0000-0000000000f1'$$) = 1, 'paid status still editable after QuickBooks fields are set');
select tests.assert_error($$select 1 from public.qbo_customer_links$$, '42501', 'owner cannot SELECT customer links');
select tests.assert_error($$insert into public.qbo_customer_links (customer_id, realm_id, user_id, qbo_customer_id)
  values ('a0000000-0000-0000-0000-0000000000c1', '999', 'aaaaaaaa-0000-0000-0000-000000000001', '1')$$, '42501', 'owner cannot forge a customer link');
select tests.assert((public.qbo_status() ->> 'invoices_ready')::boolean, 'qbo_status reports invoices_ready');

-- Another account sees none of it.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select tests.assert((select count(*) from public.invoices) = 0, 'B cannot see A''s invoice or its QuickBooks fields');
select tests.assert_error($$select 1 from public.qbo_customer_links$$, '42501', 'B cannot SELECT customer links');

-- Deleting the customer removes its link.
select tests.as_superuser();
select tests.assert(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'qbo_customer_links')
  and (select relrowsecurity from pg_class where oid = 'public.qbo_customer_links'::regclass), 'customer links: RLS on, no policies');
delete from public.customers where id = 'a0000000-0000-0000-0000-0000000000c2';
select tests.assert((select count(*) from public.qbo_customer_links) = 1, 'link is removed with its customer');

select 'qbo_invoices: all assertions passed' as result;
rollback;
