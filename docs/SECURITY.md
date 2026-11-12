# Security model

## Server side (the real boundary)

- Every user-owned table has Row Level Security with owner-only policies for
  `authenticated`: `SELECT/UPDATE/DELETE` require `user_id = auth.uid()`,
  `INSERT/UPDATE` require the new row to belong to the caller. All previous
  policies on those tables are dropped by the hardening migration, because a
  single permissive policy would override the others.
- `anon` has no table privileges.
- `id` and `user_id` cannot be changed by an update.
- Triggers check that referenced jobs, employees, customers, invoices and
  sessions belong to the same account. A foreign key alone only proves the
  row exists, not who owns it.
- Hours can be marked billed only through `record_invoice()` (SECURITY
  INVOKER, so RLS applies), which locks the sessions, verifies ownership and
  eligibility, rejects already-billed entries, stores immutable line items,
  and commits or rolls back as a unit.
- Issued invoices cannot be edited except for paid/unpaid status; invoice
  lines cannot be updated or deleted directly.
- `consume_voice_quota()` and `qbo_status()` are the only SECURITY DEFINER
  functions. Each acts only on `auth.uid()`, has `search_path = ''`, and is
  executable by `authenticated` only.
- Frontend `user_id` values are never trusted; they are checked by RLS.
- Secrets: only the public anon key is in the browser. The OpenAI key and the
  QuickBooks client secret live in Edge Function secrets.
- The service-role key is used in exactly one place: the `qbo-connect`,
  `qbo-callback` and `qbo` Edge Functions (for the `qbo_*` tables, and for
  the `qbo_*` columns of `invoices` described below), and only to read and write the two
  `qbo_*` tables. The browser app never has it.

### QuickBooks connection

- QuickBooks tokens can read and write the user's books. They are stored in
  `qbo_connections`, encrypted with AES-GCM under a key held only in Edge
  Function secrets (`QBO_TOKEN_KEY`) and bound to the owning account id, so
  a database dump alone does not reveal them. Losing or changing that key
  makes stored connections unreadable; users would reconnect.
- `qbo_connections` and `qbo_oauth_states` have RLS on with no policies and
  no privileges for `anon` or `authenticated`: app users cannot read or
  write them, not even their own row. The app reads only `qbo_status()`
  (SECURITY DEFINER, acts on `auth.uid()`, returns no tokens and no
  QuickBooks company id).
- `qbo-callback` runs without a Supabase token because it is a browser
  redirect from Intuit. It is tied to an account by a random, single-use
  `state` created for the signed-in user by `qbo-connect`: stored only as a
  SHA-256 hash, valid for 10 minutes, deleted when used. The redirect back
  to the app carries only a result code.
- One QuickBooks company can be connected to one SiteLedger account.
- Creating an invoice: the `qbo` function calls `record_invoice()` with the
  CALLER's token, so every existing ownership and double-billing check
  applies unchanged, and reads the invoice, lines and customer with the
  caller's token too (RLS decides what is visible). Only then does it use
  the service role, and only to write the `qbo_*` columns of that invoice
  and the customer link. A trigger rejects any change to `qbo_*` columns by
  app users, and the QuickBooks invoice id cannot be changed once set, by
  anyone. Recorded invoice amounts stay immutable; QuickBooks' totals are
  stored beside them.
- Data sent to QuickBooks for an invoice: the customer's name, email, phone
  and address (when the customer is first added there), and per line the
  date, job name, worker name, quantity and rate.
- Disconnect revokes the tokens at Intuit (best effort) and deletes them.

Verified with local two-account tests (`npm run test:db`). **Live verification
against production is outstanding** — see "Not yet verified" below.

## On the device

Data is stored in IndexedDB, partitioned by account id. Partitioning is an
access-control feature of the app — it stops one account's records and pending
changes from being shown to or uploaded by another account on a shared phone.
**It is not encryption.** IndexedDB is readable by:

- anyone with access to the unlocked phone and browser (developer tools, a
  file backup of the browser profile), and
- any script running on the app's origin (an XSS bug or a malicious
  extension).

### What sign-out does

- Stops syncing and cancels in-flight requests, ends the session on this
  device, removes the login tokens, and reloads the app to clear memory.
- If nothing is pending: removes that account's cached records from the
  device.
- If changes are pending: asks first. They stay on the device under that
  account (with the records they depend on) and upload the next time the
  same account signs in. Other accounts never see them; the sign-in screen
  only says that another account has unsynced changes (email masked).
- Device preferences (accent colour, tax rate, reminder time) stay.

To see retained data again you must sign in as that account, which needs a
connection.

### Lost or shared phone — residual risks

- A finder with the phone unlocked can read whatever is on the device for the
  last signed-in account (and retained pending work for others) and, while
  the refresh token is valid, use the session. Mitigation: phone lock screen;
  sign out on shared phones; change the password (which revokes refresh
  tokens on the server) if a phone is lost.
- Customer names, addresses and phone numbers, the company logo, and invoice
  totals are stored in plain form on the device.

### On encryption

A local "unlock" (PIN/passphrase) could encrypt IndexedDB records with a key
derived from the passphrase (PBKDF2/Argon2 → AES-GCM via WebCrypto). That only
helps if the key is not stored beside the data: the user would have to enter
the passphrase on every app start, including offline, and a forgotten
passphrase would make unsynced work unrecoverable. Storing the key in
IndexedDB/localStorage next to the records would provide no real protection.
It is not implemented; the phone's own lock screen and device encryption are
the main protection today.

## Not yet verified (needs production access)

- That production tables, column types and existing policies match what the
  migration expects (run `supabase/inspect/inspect_schema.sql` first).
- RLS behaviour on the live project with two real test accounts.
- Auth settings: email confirmation on, password reset redirect URL allowed
  (Site URL / Redirect URLs include the app origin), refresh-token rotation,
  JWT expiry.
- Edge Function deployed with `verify_jwt = true` and `ALLOWED_ORIGINS` set.
