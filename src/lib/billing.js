// Billing and labour-cost rules. All money is handled in integer cents.
//
// Definitions used everywhere in the app:
//   Revenue (billable)  – what the customer is charged: the job's customer
//                         rate for every session, whoever did the work.
//   Labour cost         – employee wage × hours for employee sessions. The
//                         owner's own hours carry no labour cost.
//   Gross margin        – revenue − labour cost − job expenses.
//
// Rounding policy (CAD):
//   * Billable hours are rounded to 0.01 h (half up) per session.
//   * Line amount = round(hours × rate, 2), half up, per session.
//   * Subtotal = sum of line amounts.
//   * GST = round(subtotal × rate%, 2), half up, once per invoice.
//   This matches the server check in record_invoice() exactly.
//
// Fixed-price jobs bill per person, per day (confirmed business rule): every
// session on a fixed-price job bills the half- or full-day amount once. Two
// people for a full day bill two full days.
//
// Rates are snapshotted onto the session (bill_basis, bill_rate, cost_rate)
// when it is created or its job/worker/day type changes, so later rate edits
// do not rewrite history. Sessions recorded before snapshots existed fall back
// to the current rates and are flagged `legacy`.

export const MS_PER_HUNDREDTH_HOUR = 36000;

const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export const numOrNull = v => (isNum(v) ? Number(v) : null);

export function toCents(v) {
  return isNum(v) ? Math.round(Number(v) * 100) : 0;
}
export const fromCents = c => c / 100;

// Half-up division of non-negative integers.
function divRoundHalfUp(n, d) {
  if (n < 0) return -divRoundHalfUp(-n, d);
  return Math.floor((n + d / 2) / d);
}

export function sessionDurationMs(s) {
  if (!s?.end_time || !s.start_time) return 0;
  const gross = Date.parse(s.end_time) - Date.parse(s.start_time);
  return Math.max(0, gross - (Number(s.break_seconds) || 0) * 1000);
}

export function billableHundredths(s) {
  return Math.round(sessionDurationMs(s) / MS_PER_HUNDREDTH_HOUR);
}

// Rates that apply to a session if it were recorded now.
export function currentRates({ job, employee, company = {}, dayType }) {
  let bill_basis = null;
  let bill_rate = null;
  if (job?.pricing_type === 'fixed') {
    if (dayType === 'half') { bill_basis = 'half_day'; bill_rate = numOrNull(job.half_day_rate) ?? numOrNull(company.halfDayRate); }
    else if (dayType === 'full') { bill_basis = 'full_day'; bill_rate = numOrNull(job.full_day_rate) ?? numOrNull(company.fullDayRate); }
  } else if (job) {
    bill_basis = 'hourly';
    bill_rate = numOrNull(job.rate);
  }
  return { bill_basis, bill_rate, cost_rate: employee ? numOrNull(employee.rate) : null };
}

// Snapshot fields to store on a session.
export function snapshotFor(ctx) {
  const r = currentRates(ctx);
  return { bill_basis: r.bill_basis, bill_rate: r.bill_rate, cost_rate: r.cost_rate };
}

function ctxFor(s, { jobs = [], employees = [], company = {} }) {
  return {
    job: jobs.find(j => j.id === s.job_id) || null,
    employee: s.employee_id ? employees.find(e => e.id === s.employee_id) || null : null,
    company,
    dayType: s.day_type || null,
  };
}

// What the customer is billed for one completed session.
export function sessionBilling(s, data) {
  const ctx = ctxFor(s, data);
  const hasSnapshot = s.bill_basis != null;
  const basis = hasSnapshot ? s.bill_basis : currentRates(ctx).bill_basis;
  const rate = hasSnapshot ? numOrNull(s.bill_rate) : currentRates(ctx).bill_rate;
  const legacy = !hasSnapshot;
  if (!s.end_time) return { basis, unit: null, quantityHundredths: 0, unitPriceCents: 0, amountCents: 0, legacy, missing: null };
  if (ctx.job?.pricing_type === 'fixed' && !basis) {
    return { basis: null, unit: null, quantityHundredths: 0, unitPriceCents: 0, amountCents: 0, legacy, missing: 'day_type' };
  }
  if (rate == null) return { basis, unit: basis === 'hourly' ? 'hour' : basis, quantityHundredths: 0, unitPriceCents: 0, amountCents: 0, legacy, missing: 'rate' };
  const unitPriceCents = toCents(rate);
  if (basis === 'half_day' || basis === 'full_day') {
    return { basis, unit: basis, quantityHundredths: 100, unitPriceCents, amountCents: unitPriceCents, legacy, missing: null };
  }
  const q = billableHundredths(s);
  return { basis: 'hourly', unit: 'hour', quantityHundredths: q, unitPriceCents, amountCents: divRoundHalfUp(q * unitPriceCents, 100), legacy, missing: null };
}

// Labour cost of one completed session (employees only).
export function sessionLabourCents(s, data) {
  if (!s.end_time || !s.employee_id) return 0;
  const rate = s.cost_rate != null ? numOrNull(s.cost_rate) : numOrNull(ctxFor(s, data).employee?.rate);
  if (rate == null) return 0;
  return divRoundHalfUp(Math.round(sessionDurationMs(s) / 1000) * toCents(rate), 3600);
}

export function taxCents(subtotalCents, taxRatePct) {
  const milli = Math.round((Number(taxRatePct) || 0) * 1000); // 3 decimal places of a percent
  return divRoundHalfUp(subtotalCents * milli, 100000);
}

export function totalsFromLines(lines, taxRatePct) {
  const subtotal = lines.reduce((a, l) => a + l.amountCents, 0);
  const tax = taxCents(subtotal, taxRatePct);
  return { subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
}

export function summarize(sessions, data) {
  let revenue = 0;
  let labour = 0;
  let legacy = 0;
  let missing = 0;
  for (const s of sessions) {
    if (!s.end_time) continue;
    const b = sessionBilling(s, data);
    revenue += b.amountCents;
    labour += sessionLabourCents(s, data);
    if (b.legacy) legacy += 1;
    if (b.missing) missing += 1;
  }
  return { revenueCents: revenue, labourCents: labour, legacyCount: legacy, missingCount: missing };
}

const UNIT_LABEL = { hour: 'hr', half_day: 'half day', full_day: 'full day' };
export const unitLabel = u => UNIT_LABEL[u] || '';

// Invoice lines for the record_invoice() request, in date order.
export function buildInvoiceLines(sessions, data, localDateKey) {
  return [...sessions]
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
    .map(s => {
      const b = sessionBilling(s, data);
      const job = data.jobs.find(j => j.id === s.job_id);
      const emp = s.employee_id ? data.employees.find(e => e.id === s.employee_id) : null;
      return {
        session_id: s.id,
        work_date: localDateKey(s.start_time),
        description: job?.name || '',
        worker_name: emp?.name || null,
        hours: billableHundredths(s) / 100,
        unit: b.unit,
        quantityHundredths: b.quantityHundredths,
        unitPriceCents: b.unitPriceCents,
        amountCents: b.amountCents,
        missing: b.missing,
        legacy: b.legacy,
      };
    });
}

export function toRpcLine(l) {
  return {
    session_id: l.session_id,
    work_date: l.work_date,
    description: l.description,
    worker_name: l.worker_name,
    quantity: (l.quantityHundredths / 100).toFixed(2),
    unit: l.unit,
    unit_price: (l.unitPriceCents / 100).toFixed(2),
    amount: (l.amountCents / 100).toFixed(2),
  };
}

// Same worker billed twice for one fixed-price job on one day is almost
// always a mistake (double-tapped clock-in, duplicate entry).
export function duplicateFixedBillings(sessions, data, localDateKey) {
  const seen = new Map();
  const dups = [];
  for (const s of sessions) {
    const b = sessionBilling(s, data);
    if (b.basis !== 'half_day' && b.basis !== 'full_day') continue;
    const k = `${s.job_id}|${s.employee_id || 'owner'}|${localDateKey(s.start_time)}`;
    if (seen.has(k)) dups.push([seen.get(k), s]); else seen.set(k, s);
  }
  return dups;
}

export function fmtCAD(cents) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100);
}
