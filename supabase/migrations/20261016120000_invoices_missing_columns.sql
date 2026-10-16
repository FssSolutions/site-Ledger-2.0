-- Bring the invoices table in line with what the app inserts
-- (see InvoiceModal.jsx onSaveInvoice / App.jsx addInvoice).
-- Saving failed with: "Could not find the 'customer_name' column of 'invoices'".
alter table invoices add column if not exists customer_name text;
alter table invoices add column if not exists amount numeric;
alter table invoices add column if not exists status text default 'unpaid';
alter table invoices add column if not exists date_generated date;
alter table invoices add column if not exists date_range_start date;
alter table invoices add column if not exists date_range_end date;
alter table invoices add column if not exists notes text;

-- customer_id must match the type of customers.id, so look it up rather than guess.
do $$
declare id_type text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'customer_id'
  ) then
    select format_type(a.atttypid, a.atttypmod) into id_type
    from pg_attribute a
    where a.attrelid = 'public.customers'::regclass and a.attname = 'id';
    execute format('alter table invoices add column customer_id %s', coalesce(id_type, 'uuid'));
  end if;
end $$;

-- Make PostgREST pick up the new columns immediately.
notify pgrst, 'reload schema';
