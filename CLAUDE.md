# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SiteLedger is an offline-first PWA for tracking time, mileage, expenses, and invoicing for
contractors/carpenters. React + Vite frontend, Supabase (Postgres + Auth + Edge Functions) backend.

## Commands

```sh
npm install       # install deps
npm run dev       # start Vite dev server
npm run build     # production build to dist/
npm run preview   # preview a production build locally
```

There is no test suite, no linter, and no type-checking configured in this repo (despite `@types/react`
being present, the codebase is plain JSX, not TypeScript, except for the Supabase Edge Function).
Don't assume `npm test` or `npm run lint` exist.

Required env vars (put in `.env.local`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

### Supabase Edge Function

`supabase/functions/voice-entry` (Deno/TypeScript) is deployed and configured independently of the
Vite app:

```sh
supabase secrets set OPENAI_API_KEY=...
supabase functions deploy voice-entry
```

There are no local migration files in this repo — the Postgres schema (tables, RLS policies) is
managed directly against the Supabase project, not tracked here. When reasoning about the data model,
infer table shape from `src/lib/api.js` calls and the `*ToDb`/`*FromDb` mapper functions rather than
looking for a schema file.

## Architecture

### Single-file state, multi-file view

There is no router and no global state library (Redux/Zustand/etc). `src/App.jsx` owns essentially
all application state (jobs, sessions, employees, mileage, customers, expenses, invoices, company,
the active clock-in session, break timer state) and every mutation function (`addJob`, `clockIn`,
`saveSession`, ...). The current tab is just a `useState` string; `src/pages/*Tab.jsx` components are
dumb-ish views that receive data and callbacks as props from `App.jsx`. When adding a feature, the
data/mutation logic almost always belongs in `App.jsx`, not in the page component.

The only other shared state mechanism is `AccentColorContext` (`src/lib/AccentColorContext.js`) for
the app's user-configurable brand color.

### Responsive layout is a branch, not CSS

`App.jsx` uses `useWindowWidth()` (`src/hooks/useWindowWidth.js`) and an `isDesktop` boolean
(`width >= 768`) to render two almost entirely separate JSX trees: a sidebar layout for desktop and a
bottom-nav/mobile-sheet layout for mobile. There are no CSS media queries doing this — if you change
navigation or layout, you likely need to edit both branches in `App.jsx`.

Styling throughout is inline `style={{...}}` objects (no CSS modules, no Tailwind). A few shared style
objects live in `src/styles.js` (`inp`, `lbl`, `ib`, `card`). Global resets and font imports (Syne, DM
Sans, DM Mono from Google Fonts) are in `src/index.css`.

### Data layer talks to Supabase via raw REST, not supabase-js

`src/lib/api.js` is the only data-access layer used by the app. It calls Supabase's PostgREST
(`/rest/v1/...`) and Auth (`/auth/v1/...`) HTTP endpoints directly with `fetch`, building headers by
hand (`apikey`, `Authorization: Bearer <token>`). `src/lib/supabase.js` creates a `supabase-js`
client but **nothing imports it** — it's currently dead code. Follow the existing `api.js` fetch
pattern for any new backend calls rather than introducing `supabase-js` client calls, unless you're
intentionally replacing the whole data layer.

A 401 response from `api.js` methods returns `{ _expired: true }` rather than throwing. Callers in
`App.jsx` use the `withRefresh(fn)` wrapper, which retries once after a token refresh — new API calls
that need auth should go through `withRefresh` the same way.

### Offline-first: cache + mutation queue

`src/lib/offline.js` provides two localStorage-backed mechanisms that `App.jsx` wires together:
- `cacheData`/`loadCachedData`: a full snapshot of all app data, refreshed on every state change, used
  as a fallback when a network load fails or the app is offline.
- `enqueue`/`getQueue`/`removeFromQueue`: a queue of pending mutations (`insert`/`update`/`delete`/
  `upsert_company`) recorded while offline and replayed by `syncQueue()` in `App.jsx` when connectivity
  returns.

Every mutation function in `App.jsx` follows the same shape: try `offlineInsert`/`offlineUpdate`/
`offlineDelete` first (which enqueues + applies an optimistic local update and returns `true` if
offline), and only hit the network if that returns `false`. New mutations should follow this same
pattern for offline support to keep working. Optimistic inserts get a temporary id (`'temp-' + Date.now()`)
until the real row comes back from Supabase after sync.

Auth tokens are persisted separately via `src/lib/auth.js` (`loadAuth`/`saveAuth`/`clearAuth`,
localStorage key `sl_auth_v4`) and refreshed on a 50-minute interval.

The service worker (`public/sw.js`) only caches the app shell (`/`, `/index.html`) for GETs — it
explicitly skips `/rest/v1/` and `/auth/v1/` requests, since those are handled by the app-level
cache/queue above, not the SW cache.

### DB naming vs. app naming

Postgres columns are snake_case (`job_id`, `start_time`, `gst_number`); JS objects in the app are
camelCase in some places (company profile fields) but pass through snake_case directly for most
entities (sessions, jobs, mileage). Where a mismatch exists (currently just `company_profiles`),
there are explicit mapper functions (`companyToDb`/`companyFromDb` in `App.jsx`) — add similar mappers
if you introduce a new snake_case/camelCase boundary rather than mixing conventions ad hoc.

### Domain rules worth knowing

- **Billing rate distinction**: sessions with an `employee_id` are billed at the *employee's* hourly
  rate for internal displays (Clock tab, Calendar, Reports, CSV export) via `calcEarnings()` in
  `src/lib/utils.js`, but invoice PDF generation (`src/lib/generateInvoice.js`) intentionally always
  bills at the *job* rate regardless of who worked it, since the invoice is client-facing. Don't
  "fix" this without checking `CHANGELOG.md` — it's deliberate.
- **Overtime**: daily threshold 8h, weekly threshold 44h, computed in `calcOvertime()` in
  `src/lib/utils.js` using ISO week numbers.
- **Mileage**: CRA deduction rate is a single constant `CRA_RATE` in `src/lib/constants.js`
  (currently $0.72/km); round-trip entries double the km client-side.
- **Break timer**: an active clock-in session can be paused/resumed (`breakState` in `App.jsx`,
  persisted to localStorage); break duration is subtracted from the session length at clock-out,
  not stored as a separate DB field.
- **Voice entry**: `VoiceEntryModal` records audio, sends it to the `voice-entry` Edge Function via
  `api.processVoiceEntry`, which transcribes + extracts either a `time_entry` (one or more session
  drafts for review before saving) or an `invoice_request` (opens `InvoiceModal` pre-filled) per the
  strict JSON schema defined in `supabase/functions/voice-entry/index.ts`. Only works online.

### Invoicing

PDF generation is entirely client-side via `jsPDF` + `jspdf-autotable` in `src/lib/generateInvoice.js`
— there's no server-side PDF rendering. Saved invoice records (`invoices` table) store metadata for
history/paid-unpaid tracking in the Company tab; regenerating the actual PDF re-derives it from
sessions rather than storing the rendered document.

## Change history

`CHANGELOG.md` at the repo root documents feature history in reverse chronological order and is kept
up to date by hand — check it before changing billing/overtime/invoice behavior, since several of the
domain rules above were deliberate bug fixes or product decisions, not incidental behavior.
