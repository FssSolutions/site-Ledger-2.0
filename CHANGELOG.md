# Changelog

All notable changes to Site Ledger are documented here.

---

## [Unreleased]

---

## 2026-06-09

### Employee Profit Visibility
- **Reports → Crew Hours**: each employee now shows Billed (job rate × hours), Labour (employee rate × hours), and a profit badge (green/red) so you can see margin at a glance
- **Calendar day view**: employee sessions show labour cost + profit amount below it; day header shows a total profit badge when employee sessions exist

### Employee Rate Fix
- Fixed a bug where employee sessions were billed at the job rate ($65/hr) instead of the employee's own rate ($40/hr) across all display surfaces — Clock tab today total, Calendar day totals, Reports earnings, and CSV export
- Invoice PDF generation intentionally unchanged — still bills at job rate (client-facing document)

### Break Timer
- Added pause/resume to the active clock-in session so break time doesn't count toward earnings
- "Take a Break" button freezes the work timer and starts a live break counter
- "Resume" resumes work; clock-out automatically subtracts total break time from the session duration
- Break state survives app refresh via localStorage

---

## 2026-04-21

### Expenses Tab
- New Expenses tab: log materials, tools, fuel, subcontractors, and other costs per job
- CSV export includes expenses
- Reports shows Expenses and Net Profit summary cards when expenses exist for the period

### Invoice History
- Saved invoices appear in the Company tab with paid/unpaid toggle

### Job Enhancements
- Job status: Active / Complete / Archived with filter tabs on the Jobs list
- Address field added to jobs

### Mileage
- Round-trip toggle on mileage entries automatically doubles the km
- CRA deduction rate updated to $0.72/km for 2026

### Calendar
- Hover tooltip on calendar days shows job names and total hours

### Offline Mode
- Replaced offline banner with a modal that prompts to go online or continue offline, with a retry connection button

---

## 2026-04-16

### Settings & Tax Rate
- Settings modal: configurable tax/GST rate applied to invoice totals
- Invoice PDF updated to reflect custom tax rate

---

## 2026-04-11

### Accent Color
- App-wide accent color context — brand colour applied consistently across all tabs
- Invoice modal improvements: customer selector, line item detail
- Auth screen polish

---

## 2026-04-10

### Company Tab
- Company profile: name, phone, email, address, GST#, WorkSafe#, logo upload
- Company info populates invoice PDFs automatically
- Desktop sidebar layout / mobile bottom-nav layout using `useWindowWidth` hook

### PDF Invoice Generation
- Generate professional invoices as PDF (jsPDF) filtered by job and date range
- Customer contact management (name, phone, email, address)

### Overtime Flagging
- Daily overtime threshold: 8 hours
- Weekly overtime threshold: 44 hours
- OT badges on Clock tab (live), Calendar day view, and Reports
- Per-employee overtime breakdown in Reports

---

## 2026-04-07

### Offline-First & PWA
- Service worker + `manifest.json` — installable as a PWA on iOS and Android
- localStorage cache for all data; operation queue syncs on reconnect
- Offline banner when network is unavailable
- Toast notifications for overtime and sync events

### Core App
- Initial release: Clock in/out by job, live timer, retroactive session entry
- Calendar view with tap-to-add sessions
- Mileage log with CRA deduction
- Reports: earnings, hours by job, CSV export
- Jobs CRUD with hourly rate and colour coding
- Crew/employee tracking with individual hourly rates
- Supabase auth (email/password) with RLS on all tables
- Light theme across all tabs
