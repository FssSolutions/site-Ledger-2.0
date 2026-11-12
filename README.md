# SiteLedger

Time, expense and mileage tracking for a small contracting business. Built to
keep working on a phone with no signal (a basement, a crawlspace): clock in and
out, edit hours, log expenses and trips offline; everything syncs when a
connection returns.

React 18 + Vite PWA, Supabase (Postgres + Auth + one Edge Function).

## Setup

```sh
npm ci
cp .env.example .env.local      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173 (no service worker in dev)
```

Only the Supabase URL and **anon** key go in `VITE_*` variables; they ship in
the browser bundle by design. The service-role key and the OpenAI key are
server-side secrets (`supabase secrets set …`) and must never be put in a
`VITE_*` variable.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `dist/`, including the generated service worker |
| `npm run lint` | ESLint (React hooks rules) |
| `npm test` | Unit tests (Vitest; runs in `America/Vancouver`) |
| `npm run test:db` | Applies all migrations to a throwaway Postgres and runs the two-account RLS, invoice and concurrency tests. Uses local Postgres binaries, or `TEST_DATABASE_URL` for an **empty, disposable** database. Never point it at production. |
| `npm run test:e2e` | Builds the app, starts a mock Supabase, and drives Chromium through the offline basement workflow, account isolation, invoices and auth flows |

CI (`.github/workflows/ci.yml`) runs all of the above plus `deno check` on the
Edge Function and `npm audit --omit=dev`.

## Database

Migrations live in `supabase/migrations`. **Apply the database migration
before deploying the new frontend** — see [docs/DATABASE.md](docs/DATABASE.md)
for the rollout order, backup and rollback plan, and the read-only inspection
script to run against production first.

The production base tables were created outside this repository; the test
suite uses an explicitly labelled approximation
(`supabase/tests/01_reference_baseline.sql`), which is not a description of
production.

## How offline works

See [docs/OFFLINE.md](docs/OFFLINE.md). In short: every change is written to
IndexedDB on the device together with a pending-sync entry, under the account
that made it. The banner always says whether work is saved on the device,
waiting, syncing, needs attention, or synced. Nothing is uploaded under a
different account.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model (including a
lost or shared phone), what sign-out removes, and residual risks.

## QuickBooks

Two ways to bill hours, depending on the account:

- **QuickBooks connected and set up** (Company → Profile → Connect
  QuickBooks, then *Set up invoices*): the invoice screen creates the invoice
  in QuickBooks Online and marks the hours billed in one step. The hours are
  recorded first; if QuickBooks cannot be reached, the invoice shows as
  *Not in QuickBooks yet* with a **Retry** button, and retrying never creates
  a second invoice. QuickBooks numbers the invoice and calculates the tax.
- **Not connected** (or "record it by hand"): you create the invoice in
  QuickBooks yourself, then record it here so the hours are not billed twice.
  Nothing is sent to QuickBooks.

Not built yet: paid status from QuickBooks (still a manual toggle), voiding,
emailing and PDFs from QuickBooks. See
[docs/QUICKBOOKS_PLAN.md](docs/QUICKBOOKS_PLAN.md). Deleting an invoice record
here does not delete the QuickBooks invoice.

Server setup for the connection (Edge Function secrets, never `VITE_*`):
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` (from the Intuit developer app),
`QBO_ENV` (`sandbox` or `production`), `QBO_REDIRECT_URI`
(`https://<project-ref>.supabase.co/functions/v1/qbo-callback`, also entered
in the Intuit app), `QBO_TOKEN_KEY` (32 random bytes, base64) and `APP_URL`
(where the app is hosted). Apply
`supabase/migrations/20261111120000_quickbooks_connection.sql` and
`20261112120000_quickbooks_invoices.sql`, then deploy `qbo-connect`,
`qbo-callback` and `qbo`.

## Reminders

The clock-out reminder only fires while the app is open on screen. It is not a
push notification.
