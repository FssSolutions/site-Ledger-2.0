# QuickBooks Online integration plan

Status: phase 1 in progress. Written 2026-11-03.

Done so far (2026-11-11): connect / disconnect. Migration
`20261111120000_quickbooks_connection.sql`, Edge Functions `qbo-connect` and
`qbo-callback`, and the **Connect QuickBooks** card under Company → Profile.
The invoice columns, the single `qbo` function and the schema-version bump
described below come with the invoice step.

## Goal

Stop entering the same invoice twice. Today the flow is:

1. Build the invoice by hand in QuickBooks.
2. Open SiteLedger → **Record QuickBooks Invoice**, retype the invoice number
   and total, so the hours are marked billed.
3. Flip paid/unpaid by hand in the Company tab when the client pays.

After this work:

1. In SiteLedger, pick the customer, job(s) and date range → **Create in
   QuickBooks**.
2. SiteLedger marks the hours billed *and* creates the matching invoice in
   QuickBooks (customer, one line per entry, GST), optionally emailed to the
   client by QuickBooks.
3. When the payment is recorded in QuickBooks, SiteLedger shows the invoice as
   paid on its own.

QuickBooks stays the accounting book. SiteLedger stays the source of truth for
hours and which hours are billed.

## Scope

**In (phases 1–2):** QuickBooks **Online** only. Connect/disconnect, customer
matching and import, invoice creation from recorded hours, QuickBooks PDF,
email via QuickBooks, paid-status sync, void handling.

**Later (phase 3):** expenses → QuickBooks purchases, billable expenses on
invoices, time entries for payroll, jobs ↔ QuickBooks Projects.

**Out:** QuickBooks Desktop (different, older integration method), two-way
editing of invoice lines, creating jobs or sessions from QuickBooks data.

The existing manual "Record invoice" flow stays for accounts that are not
connected, and as a fallback.

## Key design decisions

### 1. Claim hours first, then create in QuickBooks

Order matters because two systems can't be updated in one transaction.

- **Chosen:** call the existing `record_invoice()` first (it atomically claims
  the sessions and rejects double billing), then create the QuickBooks
  invoice, then store the QuickBooks id on our invoice row.
- If the QuickBooks step fails, the invoice exists in SiteLedger with
  status *Not in QuickBooks yet* and a **Retry** button. Hours are never
  billed twice, and nothing is lost.
- Rejected: QuickBooks first. If the local claim then fails (another device
  billed the same hours), we'd leave an orphan invoice in QuickBooks that has
  to be voided by hand.

### 2. All QuickBooks calls run server-side

QuickBooks tokens can read and write the user's books, so they never reach the
browser. They're stored in a table the browser has no access to, encrypted
with a key held in Edge Function secrets, and only Supabase Edge Functions
use them. This makes these functions the first code to use the
service-role key, so it must stay inside them (update
[SECURITY.md](SECURITY.md)).

### 3. No duplicate invoices on retry

Every create call sends Intuit's `requestid` parameter set to our invoice
uuid (the same id `record_invoice()` already uses for idempotency), so a retry
after a lost response returns the same QuickBooks invoice. The QuickBooks id is
saved the moment it comes back.

### 4. QuickBooks decides tax and invoice number

- **Tax:** QuickBooks Canada uses automated sales tax; each line carries a
  tax code (e.g. GST) and QuickBooks calculates the tax. SiteLedger keeps
  showing its own preview, then stores what QuickBooks calculated. A
  difference of more than a few cents is flagged.
- **Invoice number:** QuickBooks assigns it (or accepts ours if the company has
  custom transaction numbers turned on). This also fixes the current
  per-device counter in `localStorage` (`sl_next_invoice_num`), which can
  repeat across phones.

### 5. The SiteLedger invoice record stays immutable

The existing guard (`sl_guard_invoice_update`) keeps issued invoice amounts
fixed. QuickBooks data goes into **new** `qbo_*` columns instead (QuickBooks
total, balance, number, status). If you add materials to the invoice in
QuickBooks later, the new total shows up next to the original
calculated amount. Nothing gets rewritten.

## Data model changes (one new migration)

**`qbo_connections`** (one row per account; no access for `authenticated`)

| Column | Notes |
| --- | --- |
| `user_id` | primary key, references `auth.users` |
| `realm_id` | QuickBooks company id |
| `access_token_enc`, `refresh_token_enc` | AES-GCM encrypted; key in `QBO_TOKEN_KEY` secret |
| `access_expires_at`, `refresh_expires_at` | |
| `status` | `connected` / `needs_reconnect` / `disconnected` |
| `labour_item_id`, `half_day_item_id`, `full_day_item_id` | QuickBooks items used on lines |
| `tax_code_id` | e.g. GST |
| `company_name`, `connected_at`, `updated_at` | for display |

The browser reads a **safe view or RPC** (`qbo_status()`) that returns only
status, company name and the chosen settings, never tokens.

**`customers`**: add `qbo_customer_id`.

**`invoices`**: add
`qbo_invoice_id`, `qbo_doc_number`, `qbo_status`
(`pending` / `created` / `failed` / `voided` / `deleted`), `qbo_total`,
`qbo_tax`, `qbo_balance`, `qbo_error`, `qbo_synced_at`.
A trigger rejects changes to `qbo_*` columns from the `authenticated` role
(only the Edge Functions write them), and `qbo_invoice_id` can be set once
but never changed.

**`qbo_webhook_events`**: raw event id + entity + received time, for
de-duplication and replay.

Bump `ledger_schema_version()` to 3 so older app builds hold changes rather
than sending to a schema they don't know (the existing mechanism in
[DATABASE.md](DATABASE.md)).

Add tests in `supabase/tests/` (`40_qbo.sql`): another account can't read
tokens, `authenticated` can't edit `qbo_*`, and `qbo_invoice_id` can only be
set once.

## Edge Functions

| Function | JWT | Purpose |
| --- | --- | --- |
| `qbo-connect` | yes | Returns the Intuit sign-in URL with a one-time `state` tied to the user |
| `qbo-callback` | no (browser redirect from Intuit) | Checks `state`, swaps the code for tokens, stores them encrypted, redirects to the app (`/#qbo=connected`) |
| `qbo` | yes | Actions: `status`, `settings` (list items and tax codes, save choices), `customers` (list, match, import), `create-invoice`, `retry-invoice`, `invoice-pdf`, `send-invoice`, `disconnect` |
| `qbo-webhook` | no; checks Intuit's HMAC signature | Receives Invoice/Payment change events, de-duplicates, refreshes the affected invoices |
| `qbo-reconcile` | scheduled (daily) | Uses Intuit's change-data-capture to catch any missed webhooks |

Shared module `supabase/functions/_shared/qbo.ts`: token refresh (with a row
lock so two requests don't refresh at once; always store the newest refresh
token Intuit returns), request helper with timeout, `minorversion` pinned,
sandbox/production base URL, error mapping.

`create-invoice` flow, all in one request from the app:

1. Validate the request (same shape `InvoiceModal` sends today).
2. Call `record_invoice()` **with the user's JWT**, so RLS and all existing
   checks apply unchanged. Set `qbo_status = pending`.
3. Make sure the customer is linked (step "Customer matching" below).
4. Build the QuickBooks payload from the stored `invoice_lines`, not from the
   request, so QuickBooks gets exactly what was recorded.
5. `POST /invoice?requestid=<invoice uuid>`.
6. Save `qbo_invoice_id`, `qbo_doc_number`, `qbo_total`, `qbo_tax`,
   `qbo_balance`, `qbo_status = created`.
7. If the user asked: `POST /invoice/{id}/send`.
8. On any failure after step 2: `qbo_status = failed`, `qbo_error` set to a
   plain-language message; the app offers Retry.

Secrets: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`,
`QBO_WEBHOOK_VERIFIER`, `QBO_TOKEN_KEY`, `QBO_ENV` (`sandbox`/`production`).
None in `VITE_*`.

## Mapping SiteLedger → QuickBooks

| SiteLedger | QuickBooks |
| --- | --- |
| customer (`customers`) | `Customer` (matched by `qbo_customer_id`, else by display name/email) |
| invoice | `Invoice`; `DocNumber` from QuickBooks; `TxnDate` = today; `PrivateNote` = `SiteLedger <uuid>` |
| hourly `invoice_lines` row | `SalesItemLineDetail`: labour item, `Qty` = hours, `UnitPrice` = rate, `ServiceDate` = work date, `TaxCodeRef` = GST |
| half/full-day line | same, with the half-day/full-day item, `Qty` = 1 |
| line description | `Mon Oct 14 · Mike · Kitchen reno` (date, worker, job) |
| job address | invoice memo / shipping address (optional) |

**Line grouping** (decision needed): one QuickBooks line per entry matches the
current PDF and `invoice_lines` exactly. A summary option (one line per job
per day, or per job) is easy to add because it only changes the payload,
not what is stored.

## Customer matching

- **Settings → QuickBooks → Import customers:** pull QuickBooks customers
  into SiteLedger (name, email, phone, address) and link them, so you never
  type a customer twice.
- When creating an invoice for an unlinked customer: one exact name match →
  link automatically; several → ask which; none → create the customer in
  QuickBooks.

## App changes

- **Company tab / Settings:** *Connect QuickBooks* card showing status and
  company name, plus a one-time setup: pick the labour item, half/full-day
  items (or "create them for me") and the GST tax code.
  *Reconnect* when Intuit's access expires; *Disconnect*.
- **[InvoiceModal.jsx](../src/components/InvoiceModal.jsx):** when connected,
  the button becomes **Create in QuickBooks**, the invoice number and
  "amount on the QuickBooks invoice" fields go away, and an *Email to
  client from QuickBooks* checkbox appears. Same rules as today: needs
  internet, and every entry has to be synced first ("Sync now").
- **Success screen:** QuickBooks invoice number, *Open in QuickBooks*,
  *Download PDF* (QuickBooks' own PDF, so the client and you see the same
  document).
- **[CompanyTab.jsx](../src/pages/CompanyTab.jsx) invoice list:** QuickBooks
  badge and number; *Not in QuickBooks yet, Retry*; paid status read-only
  for linked invoices ("updated from QuickBooks"); QuickBooks total shown when
  it differs.
- **Deleting a linked invoice:** blocked until it's voided or deleted in
  QuickBooks. Once the webhook reports the void, the app offers
  *Release these hours back to unbilled* (the existing delete path).
- **[useLedger.js](../src/hooks/useLedger.js):** `createQboInvoice`,
  `retryQboInvoice`, `qboStatus`; the invoice rows from the server already
  flow into IndexedDB through `putServerRows`.
- **Tax-rate setting:** stays as the preview rate; label it "preview only,
  QuickBooks calculates the tax" when connected.

## Paid status and changes made in QuickBooks

- Webhooks for `Invoice` and `Payment`: fetch the invoice, update
  `qbo_balance` and `qbo_total`; balance 0 → `status = paid`, otherwise
  `unpaid`. Void/delete → `qbo_status = voided/deleted`.
- The webhook handler only records the event and returns quickly; the work
  happens right after, and the daily `qbo-reconcile` catches anything
  missed.
- The app pulls fresh invoice rows on open and after these updates, as it
  does today.

## Phases

**Phase 0: setup (1–2 days of work, plus Intuit's wait time; start now)**
- Intuit developer account, app, sandbox company.
- Start the **production app assessment** (security/compliance
  questionnaire) right away. Connecting your own real QuickBooks company
  needs production keys, so this is the longest wait.
- You need a privacy policy URL, terms URL, and a deployed HTTPS callback.
- Spike: create a Canadian sandbox invoice with a GST tax code by hand to
  confirm the payload and how QuickBooks rounds tax.

**Phase 1: no more double entry (about 1 week)**
- Migration + DB tests, `qbo-connect` / `qbo-callback` / `qbo` functions.
- Settings: items and tax code; customer import and matching.
- Create in QuickBooks from InvoiceModal, retry, QuickBooks PDF, email via
  QuickBooks.
- Unit tests for the payload builder (`qbo.test.ts`, like
  `validate.test.ts`); add a mock QuickBooks server to the e2e suite next to
  `mockSupabase.mjs`.

**Phase 2: no more manual paid toggles (3–4 days)**
- `qbo-webhook`, `qbo-reconcile`, void handling, read-only paid status.

**Phase 3: later**
- Expenses → QuickBooks `Purchase` (category → expense account mapping).
- Billable expenses/materials as invoice lines.
- Jobs ↔ QuickBooks Projects for job costing.
- Time entries (`TimeActivity`) for QuickBooks Payroll users.

## Risks and things to check during phase 0

- **Intuit review time** is outside our control; start early.
- **Tax rounding:** QuickBooks may round GST differently from
  `taxCents()` in [billing.js](../src/lib/billing.js). We store
  QuickBooks' figure; confirm the difference is cents at most.
- **Token expiry:** if the refresh token expires or the user revokes access,
  status becomes *needs reconnect*; invoices queue as *Not in QuickBooks
  yet* until reconnected. Check Intuit's current refresh-token lifetime
  rules.
- **Intuit API fees:** Intuit's App Partner Program charges for some API
  usage (mostly reads) above a free allowance. Invoice creation is a
  free-tier call; confirm the current limits before relying on
  webhooks-plus-polling volumes.
- **Webhook format:** Intuit has been moving webhooks to a new
  (CloudEvents) payload format; build against whichever is current.
- **API minor versions:** pin the current `minorversion`; Intuit retired the
  old ones.
- **Existing invoices** (3 in production) stay manual. Optionally add
  *Link to existing QuickBooks invoice* by number later.
- **Payments:** if clients pay through QuickBooks Payments, a Stripe payment
  link (see the monetisation notes) would compete with it; decide before
  building both.

## Open decisions

1. **QuickBooks Online, not Desktop?** (Plan assumes Online.)
2. **Line detail on the invoice:** one line per entry (current PDF), or
   summarised per job per day?
3. **Invoice numbers:** let QuickBooks number them (recommended)?
4. **Email from QuickBooks** by default, or download/send yourself?
5. **Do you add materials in QuickBooks after the fact?** If yes, phase 3's
   billable expenses becomes more important.
6. **Do you use QuickBooks Projects** for jobs?
7. **Tax codes:** GST only on labour, or do some jobs need PST/HST?
