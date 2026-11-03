# Review findings (2026-11-03, from commit e1002d3)

Each lead from the earlier review was checked against the code before fixing.

## Plan, ranked by data/security impact

1. Database isolation: RLS on every table, owner checks for references, atomic invoice claims.
2. Account partitioning of on-device data and pending changes.
3. Reliable offline storage and idempotent sync (no lost/duplicated records).
4. Explicit API/auth error handling; supabase-js auth with recovery.
5. Billing correctness (customer rate vs wage), snapshots, rounding.
6. Time, breaks, dates, overtime, mileage.
7. Voice function quotas/validation; CSV escaping.
8. PWA shell, dependencies, maintainability, accessibility, docs, CI.

## Confirmed findings and changes

| Lead | Confirmed in code? | Change |
| --- | --- | --- |
| Shared localStorage keys for cache and queue | Yes (`sl_data_cache`, `sl_offline_queue`) | IndexedDB keyed by account; legacy keys backed up and removed |
| Pending inserts re-owned by whoever syncs | Yes (`user_id` replaced at sync) | Ops store their owner; data client bound to one account id |
| Sign-out left queue and cache | Yes | Stops sync, keeps pending under owner, clears cache, reloads |
| Failed reads `[]`, writes `null`, deletes `undefined` | Yes (`api.js`) | Explicit `{ok, error}` results; old client removed |
| Partial load failure ignored for expenses/invoices | Yes | Pull keeps last good copy per table |
| Offline clock-in + clock-out = two inserts | Yes (temp id path enqueued a second insert) | Unsent ops coalesce |
| Temp ids break references | Yes (`temp-…` job ids) | Device-assigned uuids |
| Navigator.onLine trusted | Yes | Reachability learned from requests |
| Invoice: insert then separate session update | Yes (could orphan or partially bill) | `record_invoice()` RPC, atomic and idempotent |
| PDF generated even when recording failed | Yes | PDF only after success, from stored lines |
| $65 job / $40 wage invoiced at $320 | Yes (`calcEarnings` used wage for employees) | Revenue always uses job rate |
| PDF rate label vs amount mismatch | Yes (label job rate, amount wage) | Both from the same line |
| `day_type` dropped on manual save/edit | Yes | Single mapper, tested on every path |
| Truthiness defaults replace `0` | Yes (`|| null`) | `numOrNull` |
| Break subtracted from end time; state global | Yes | `break_seconds`/`break_started_at` on the session |
| UTC dates (`toISOString().slice(0,10)`, `new Date('YYYY-MM-DD')`) | Yes | Local date keys |
| Overtime combines all workers | Yes | Per worker, BC rules, no double count |
| Voice forces invoice on the word "invoice" | Yes (server and client) | Removed; prompt clarified |
| No voice quota / timeouts / output validation | Yes | Added |
| CSV not escaped | Yes | RFC 4180 + formula guard |
| Service worker cached only `/` | Yes; also broke offline with crossorigin assets | Build-generated complete shell |
| Password reset callback not handled | Yes | supabase-js recovery + new-password screen |
| Sign-up confirmation assumed instant sign-in | Yes | Confirmation message |
| Supabase 1000-row limit could truncate | Yes (no paging) | Paginated pulls |
| Historical backfill marks all accounts | Yes | Moved to single-account manual script |

Additional issues found while working:

- An expired token offline left the app on "Loading…" for ~30 s (supabase-js
  refresh retries). Local data now opens immediately.
- The first service-worker install reloaded the page (and wiped a half-typed
  form). Only user-approved updates reload now.
- `company_profiles` upserts had no conflict target, so each save could add a
  row and reloads read the oldest. The app now updates the existing row; the
  migration adds a unique index when safe.
- BC moved to permanent UTC−7 in tzdata 2026e; tests no longer hard-code a
  November 2026 fall-back.
