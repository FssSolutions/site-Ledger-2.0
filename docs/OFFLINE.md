# Offline behaviour

## What happens when you tap Save with no signal

1. The record and a "pending change" entry are written to IndexedDB in one
   transaction, keyed by your account id. If the write fails (for example the
   phone is out of storage) you see an error and the form keeps what you
   typed — the app never says "saved" for a change that was not stored.
2. The screen updates from the device copy. Records not yet on the server show
   an orange dot or "not synced".
3. The sync engine tries to upload. `navigator.onLine` is only a hint; the app
   learns it is offline when a request fails, and retries with a growing delay
   (2 s doubling to at most 5 minutes) and whenever the connection or the app
   comes back.

The banner at the top always says which state you are in: *saved on this
device*, *waiting to sync*, *syncing*, *N changes could not sync (tap to
review)*, or nothing at all when everything is synced.

## Guarantees

- **Stable ids.** Records get their final id on the device, so a job created
  offline and the sessions, expenses and trips added to it keep their links.
- **One session per clock-in.** Clock-in, breaks and clock-out made before the
  first upload are merged into a single insert.
- **No duplicates on retry.** Creates are "insert if absent"; if the server
  saved a change but the reply was lost, the retry finds the record instead
  of creating a second one.
- **Changes leave the device only after the server confirms them.** Failed
  changes stay, marked as errors, until you retry or discard them (discarding
  asks first).
- **Conflicts are shown, not overwritten.** Every server row has a version.
  If another device changed a record (for example billed it) after this
  device last saw it, your change is held as a conflict and the review panel
  shows both versions; you choose which to keep.
- **Changes that may have reached the server are never altered.** Later edits
  become a new change.
- **One tab syncs at a time** (Web Locks), and other tabs refresh their view.
- **Breaks** are stored on the session itself (`break_seconds`,
  `break_started_at`), so they survive a refresh, a failed clock-out, or
  switching phones. Start/end times are the real times.

## Needs a connection

Signing in, voice entry, recording an invoice (and marking its hours billed),
changing an invoice's paid status, and deleting an invoice record. Recording
an invoice also requires every selected entry to have synced first; the
invoice screen offers **Sync now**.

## When the login expires while offline

You can keep working: the app opens your on-device data from the stored
session without contacting the server, and changes keep queuing. When the
connection returns the session refreshes and everything syncs. If the server
refuses the session (password changed, signed out elsewhere), you are asked
to sign in again; the pending changes stay on the device under your account
and upload after you sign back in as the same account.

## App updates

A new version downloads in the background and waits. A blue banner offers
**Update**; tapping it reloads into the new version. Pending changes live in
IndexedDB, not in the app cache, and storage upgrades only ever add, so an
update never discards them.

## Storage eviction

The app asks the browser for persistent storage. Even so, a browser may clear
site data under storage pressure, and iOS Safari can remove data for websites
not used for a while. Installing to the home screen ("Add to Home Screen")
makes this much less likely. Sync regularly; data on the server is the
durable copy.

## Recovering data from an older version

Versions before November 2026 kept data in shared `localStorage` keys without
recording which account made each change. On first launch the new version
copies those keys into an on-device backup (IndexedDB store `legacy`),
verifies the copy, and only then removes the originals.

- If the old login token belonged to the account now signed in, a banner
  offers to **review** the old unsynced changes. Nothing is uploaded unless
  you confirm they are yours. Edits to existing records are checked against
  the server and shown as conflicts if they differ.
- If no login token was stored (you had signed out), the old changes cannot
  be attributed, so they are never shown to whoever signs in next or uploaded
  automatically. They remain in the backup. To recover them, the owner can
  open the browser's developer tools on that device (Application → IndexedDB
  → `siteledger` → `legacy`) and export the record, or ask for help
  re-entering them.
