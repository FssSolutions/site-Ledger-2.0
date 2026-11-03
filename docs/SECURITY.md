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
- `consume_voice_quota()` is the only SECURITY DEFINER function. It acts only
  on `auth.uid()`, has `search_path = ''`, and is executable by
  `authenticated` only.
- Frontend `user_id` values are never trusted; they are checked by RLS.
- Secrets: only the public anon key is in the browser. The OpenAI key lives in
  Edge Function secrets. The service-role key is not used by the app.

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
