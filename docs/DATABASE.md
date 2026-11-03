# Database changes and rollout

## Migrations in this repository

| File | Status | What it does |
| --- | --- | --- |
| `20260721194037_fixed_price_jobs.sql` | existing | Fixed-price columns |
| `20261102120000_session_billing.sql` | existing, **edited** | `sessions.invoice_id`. The all-accounts historical backfill was removed from this file (see below). |
| `20261103120000_security_and_sync_hardening.sql` | **new** | RLS, ownership checks, versions, break/snapshot columns, `invoice_lines`, `record_invoice()`, voice quota |

The new migration is additive. It deletes no rows and rewrites no existing
values (new columns get defaults). New CHECK constraints are `NOT VALID`:
existing rows are not re-checked, future writes are. It is safe to re-run.
It starts with precondition checks and aborts **before changing anything** if
a table is missing or an `id`/`user_id` column is not `uuid`.

What it changes that affects access:

- **Drops every existing policy** on `jobs, sessions, employees, mileage,
  customers, company_profiles, expenses, invoices` and creates owner-only
  policies. Review the current policies (inspection script, section 3) before
  applying.
- Revokes all table privileges from `anon`.

## Rollout order (production actions — awaiting approval)

1. **Back up.** Supabase Dashboard → Database → Backups (confirm a recent
   backup or PITR point), or `pg_dump --schema=public --data-only` of the
   eight tables to a secure location. Record the time.
2. **Inspect (read-only).**
   `psql "$DATABASE_URL" -X -f supabase/inspect/inspect_schema.sql > inspect-before.txt`
   Check: all `id`/`user_id` are `uuid`; list of current policies; foreign-key
   `ON DELETE` behaviour; any rows with null `user_id`, cross-account
   references, duplicate company profiles, or more than one open session;
   which accounts have a "Billed before Oct 25, 2026" record.
3. **Apply the migration** to production (in a transaction):
   `supabase db push` (or run the file in the SQL editor). If the
   precondition check fails, nothing changed; share the message.
4. **Verify** with the two test accounts (see "Live verification" below).
5. **Deploy the Edge Function** (`supabase functions deploy voice-entry`) and
   set `ALLOWED_ORIGINS`.
6. **Deploy the frontend.**
7. On each phone, open the app online once, then test offline (checklist in
   the final report / README).

### Why the database must go first

The new app sends `break_seconds`, `bill_rate`, etc., and calls
`record_invoice()`. Before syncing it calls `ledger_schema_version()`; if that
function is missing or older, the app **holds all changes on the device** and
shows "Server update pending" instead of sending columns the server does not
have. So deploying the frontend first is safe for data, but nothing syncs
until the migration is applied.

The old app mostly keeps working against the migrated database for reads and
simple edits (RLS still allows a user's own rows), with two exceptions:

- **Recording an invoice from the old version** creates the invoice record
  and then fails to mark the hours billed (direct `invoice_id` updates are now
  refused by design). It shows an error; delete the leftover invoice record.
- **Saving the company profile from the old version** may fail once the
  one-profile-per-account index exists.

Update every device promptly after the migration.

## Rollback

- **Frontend:** redeploy the previous build. Pending changes created by the
  new version stay in IndexedDB; the old version does not read them, and they
  sync again once the new version is redeployed. Do not clear site data.
- **Database:** the migration is additive, so the usual rollback is to leave
  it in place. To revert access rules only, restore the policies captured in
  `inspect-before.txt`. To remove the new objects (only if no new invoices
  were recorded): drop triggers `sl_*`, functions `record_invoice`,
  `consume_voice_quota`, `ledger_schema_version`, `sl_*`, and tables
  `invoice_lines`, `voice_usage`. Dropping the new columns would lose break
  and rate-snapshot data recorded since the rollout — avoid. A full restore
  from the step-1 backup loses everything entered since then.

## Historical billing backfill ("Billed before Oct 25, 2026")

`20261102120000_session_billing.sql` originally marked **every account's**
completed sessions before 2026-10-25 (Vancouver) as billed, grouped under a
paid $0 invoice record per account. That reconciliation was meant for one
account.

- It has been moved to `supabase/reconciliation/20261025_mark_prior_sessions_billed.sql`,
  scoped to one `user_id`, manual only.
- If the original migration already ran in production, the backfill **already
  happened for all accounts**; editing the file does not undo it, and nothing
  here reverses it automatically.
- Inspection section 10 shows how many accounts have a backfill record. If
  accounts other than the intended one appear, review with those users before
  deleting their record (deleting it returns their sessions to unbilled).

## Legacy data notes

- Sessions recorded before this change have no rate snapshot; they use current
  job and wage rates and are flagged in Reports. They are not back-filled with
  guessed historical rates. Each one gets a snapshot (at the then-current
  rates) the next time it is edited.
- Invoices recorded before this change have no line items or totals
  breakdown; the app shows them as "recorded before line-by-line snapshots".
- If `company_profiles` has more than one row per account, the unique index
  is skipped and the app uses the most recently updated row. Merge or delete
  the extra rows manually, then re-run the migration to add the index.

## Live verification checklist (with two throwaway test accounts)

Run with the anon key and each account's JWT (e.g. from the browser), not the
service role:

1. A creates a job/session/customer; B's `select` on each table returns `[]`.
2. B `PATCH`/`DELETE` of A's row ids affects 0 rows; B `POST` with
   `user_id = A` → 403.
3. B inserts a session with `job_id` = A's job → 403.
4. Without a token (`apikey` only) every table returns 401/permission denied.
5. `rpc/record_invoice` from B with A's session ids → error, nothing written.
6. Two simultaneous `record_invoice` calls for the same session → one wins.
