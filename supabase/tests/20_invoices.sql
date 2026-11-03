-- record_invoice(): atomic, idempotent, ownership-checked. Synthetic data.
begin;

select tests.as_superuser();
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.jobs (id, name, rate) values ('a0000000-0000-0000-0000-00000000000a', 'A job', 65);
insert into public.employees (id, name, rate) values ('a0000000-0000-0000-0000-0000000000e1', 'A worker', 40);
insert into public.sessions (id, job_id, employee_id, start_time, end_time, bill_basis, bill_rate, cost_rate) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000e1', '2026-10-01 08:00-07', '2026-10-01 16:00-07', 'hourly', 65, 40),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', null, '2026-10-02 08:00-07', '2026-10-02 12:00-07', 'hourly', 65, null),
  ('a1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', null, '2026-10-03 08:00-07', null, 'hourly', 65, null);

-- Helper: the request the app sends for sessions 1 and 2 at $65/h, 5% GST.
create temp table req as select
  jsonb_build_object('id', 'a2000000-0000-0000-0000-000000000001', 'customer_name', 'Cust', 'status', 'unpaid',
    'date_generated', '2026-10-05', 'date_range_start', '2026-10-01', 'date_range_end', '2026-10-05', 'notes', 'INV-001',
    'subtotal', 780.00, 'tax_rate', 5, 'tax_amount', 39.00, 'calculated_total', 819.00, 'amount', 819.00) as inv,
  array['a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002']::uuid[] as ids,
  jsonb_build_array(
    jsonb_build_object('session_id', 'a1000000-0000-0000-0000-000000000001', 'quantity', 8, 'unit', 'hour', 'unit_price', 65, 'amount', 520.00, 'work_date', '2026-10-01', 'worker_name', 'A worker'),
    jsonb_build_object('session_id', 'a1000000-0000-0000-0000-000000000002', 'quantity', 4, 'unit', 'hour', 'unit_price', 65, 'amount', 260.00, 'work_date', '2026-10-02')
  ) as lines;
grant select on req to authenticated;

-- Eight hours at $65 bills $520 even though the worker earns $40.
select tests.assert((select (l ->> 'amount')::numeric from req, jsonb_array_elements(lines) l limit 1) = 520, 'fixture line is 520');

-- Totals that don't match the lines are rejected.
select tests.assert_error($$select public.record_invoice(inv || '{"subtotal": 320}'::jsonb, ids, lines) from req$$, '22023', 'mismatched subtotal rejected');
select tests.assert_error($$select public.record_invoice(inv, ids, jsonb_set(lines, '{0,amount}', '321')) from req$$, '22023', 'line amount must equal qty x price');
select tests.assert_error($$select public.record_invoice(inv, ids[1:1], lines) from req$$, '22023', 'lines must match entries');
-- An active session cannot be billed.
select tests.assert_error($$select public.record_invoice(inv, ids || 'a1000000-0000-0000-0000-000000000003'::uuid,
   lines || jsonb_build_array(jsonb_build_object('session_id','a1000000-0000-0000-0000-000000000003','quantity',0,'unit','hour','unit_price',65,'amount',0))) from req$$,
  '22023', 'active session cannot be billed');
-- An unsynced (unknown) session is reported, and nothing is written.
select tests.assert_error($$select public.record_invoice(inv, ids || 'a1000000-0000-0000-0000-0000000000ff'::uuid,
   lines || jsonb_build_array(jsonb_build_object('session_id','a1000000-0000-0000-0000-0000000000ff','quantity',1,'unit','hour','unit_price',65,'amount',65))) from req$$,
  'P0002', 'unknown session rejected');
select tests.assert((select count(*) from public.invoices) = 0, 'failed attempts leave no orphan invoice');
select tests.assert((select count(*) from public.sessions where invoice_id is not null) = 0, 'failed attempts leave no billed hours');

-- Success.
select public.record_invoice(inv, ids, lines) from req;
select tests.assert((select count(*) from public.sessions where invoice_id = 'a2000000-0000-0000-0000-000000000001') = 2, 'both sessions claimed');
select tests.assert((select count(*) from public.invoice_lines where invoice_id = 'a2000000-0000-0000-0000-000000000001') = 2, 'two lines stored');
select tests.assert((select amount from public.invoices where id = 'a2000000-0000-0000-0000-000000000001') = 819.00, 'amount stored');
select tests.assert((select issued_at is not null from public.invoices where id = 'a2000000-0000-0000-0000-000000000001'), 'issued_at set');

-- Retry with the same request id (lost response) returns the same invoice, no duplicate.
select tests.assert((select (public.record_invoice(inv, ids, lines) ->> 'replayed')::boolean from req), 'retry is a replay');
select tests.assert((select count(*) from public.invoices) = 1, 'retry did not duplicate the invoice');

-- A second invoice cannot claim already-billed sessions.
select tests.assert_error($$select public.record_invoice(inv || '{"id":"a2000000-0000-0000-0000-000000000002","notes":"INV-002"}'::jsonb, ids, lines) from req$$,
  '40001', 'already-billed sessions rejected');
select tests.assert((select count(*) from public.invoices) = 1, 'rejected second invoice left no orphan');

-- Same request id reused with different sessions is refused.
select tests.assert_error($$select public.record_invoice(inv, ids[1:1], lines -> 0 || '[]'::jsonb) from req$$, '', 'request id reuse with different entries refused');

-- Issued invoice details are immutable; status can change.
select tests.assert_error($$update public.invoices set amount = 1 where id = 'a2000000-0000-0000-0000-000000000001'$$, '42501', 'issued amount immutable');
select tests.assert_error($$update public.invoices set notes = 'INV-999' where id = 'a2000000-0000-0000-0000-000000000001'$$, '42501', 'issued number immutable');
update public.invoices set status = 'paid' where id = 'a2000000-0000-0000-0000-000000000001';
select tests.assert((select status from public.invoices where id = 'a2000000-0000-0000-0000-000000000001') = 'paid', 'status can change');
select tests.assert_error($$update public.invoice_lines set amount = 1$$, '42501', 'lines cannot be updated');
select tests.assert_error($$delete from public.invoice_lines$$, '42501', 'lines cannot be deleted directly');
select tests.assert_error($$insert into public.invoice_lines (invoice_id, line_no, quantity, unit, unit_price, amount) values ('a2000000-0000-0000-0000-000000000001', 9, 1, 'hour', 1, 1)$$,
  '42501', 'issued invoice cannot gain lines');

-- Rate change after billing doesn't alter the snapshot.
update public.jobs set rate = 99 where id = 'a0000000-0000-0000-0000-00000000000a';
select tests.assert((select sum(amount) from public.invoice_lines where invoice_id = 'a2000000-0000-0000-0000-000000000001') = 780.00, 'invoice lines unchanged by rate change');
select tests.assert((select bill_rate from public.sessions where id = 'a1000000-0000-0000-0000-000000000001') = 65, 'session rate snapshot unchanged');

-- Deleting a job with billed hours is refused.
select tests.assert_error($$delete from public.jobs where id = 'a0000000-0000-0000-0000-00000000000a'$$, '23503', 'job with billed hours cannot be deleted');

-- B cannot see, bill, or delete A's invoice/sessions.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select tests.assert((select count(*) from public.invoice_lines) = 0, 'B cannot read A lines');
select tests.assert_error($$select public.record_invoice(inv || '{"id":"b2000000-0000-0000-0000-000000000001"}'::jsonb, ids, lines) from req$$,
  'P0002', 'B cannot bill A sessions');
select tests.assert(tests.rows_affected($$delete from public.invoices$$) = 0, 'B cannot delete A invoice');
select tests.assert_error($$select public.record_invoice(inv, ids, lines) from req$$, 'P0002', 'B cannot replay A request id');

-- Deleting the invoice releases its sessions and removes its lines, atomically.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
delete from public.invoices where id = 'a2000000-0000-0000-0000-000000000001';
select tests.assert((select count(*) from public.sessions where invoice_id is not null) = 0, 'delete releases sessions');
select tests.assert((select count(*) from public.invoice_lines) = 0, 'delete removes lines');

-- Voice quota counts per user and cannot be reset by the user.
select public.consume_voice_quota(1000);
select tests.assert((select count(*) from public.voice_usage) = 1, 'usage recorded');
select tests.assert_error($$delete from public.voice_usage$$, '42501', 'user cannot delete usage');
select tests.assert_error($$insert into public.voice_usage (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001')$$, '42501', 'user cannot insert usage');
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select tests.assert((select count(*) from public.voice_usage) = 0, 'B cannot see A usage');
select tests.assert((select public.consume_voice_quota(10) ->> 'used_last_hour')::int = 1, 'quota is per user');

select 'invoices: all assertions passed' as result;
rollback;
