import { describe, it, expect } from 'vitest';
import {
  sessionBilling, sessionLabourCents, summarize, snapshotFor, buildInvoiceLines, toRpcLine,
  totalsFromLines, taxCents, toCents, duplicateFixedBillings, sessionDurationMs,
} from '../src/lib/billing.js';
import { localDateKey } from '../src/lib/time.js';

const job = { id: 'j1', name: 'Kitchen', rate: 65, pricing_type: 'hourly' };
const fixedJob = { id: 'j2', name: 'Deck', rate: 0, pricing_type: 'fixed', half_day_rate: null, full_day_rate: 750 };
const worker = { id: 'e1', name: 'Sam', rate: 40 };
const company = { halfDayRate: 400, fullDayRate: 700 };
const data = { jobs: [job, fixedJob], employees: [worker], company };

const eightHours = { id: 's1', job_id: 'j1', employee_id: 'e1', start_time: '2026-10-01T15:00:00Z', end_time: '2026-10-01T23:00:00Z' };

describe('customer billing vs labour cost', () => {
  it('8 h at a $65 job rate bills $520 before tax despite a $40 employee wage', () => {
    expect(sessionBilling(eightHours, data).amountCents).toBe(52000);
    expect(sessionLabourCents(eightHours, data)).toBe(32000);
    const sum = summarize([eightHours], data);
    expect(sum.revenueCents).toBe(52000);
    expect(sum.labourCents).toBe(32000);
  });

  it('owner hours bill the job rate and have no labour cost', () => {
    const own = { ...eightHours, employee_id: null };
    expect(sessionBilling(own, data).amountCents).toBe(52000);
    expect(sessionLabourCents(own, data)).toBe(0);
  });

  it('breaks are excluded from billable hours', () => {
    const s = { ...eightHours, end_time: '2026-10-01T23:30:00Z', break_seconds: 1800 };
    expect(sessionDurationMs(s)).toBe(8 * 3600000);
    expect(sessionBilling(s, data).amountCents).toBe(52000);
  });

  it('rounds hours to 0.01 and the line to cents, half up', () => {
    // 7 h 59 m = 7.9833 h -> 7.98 h x 65 = 518.70
    const s = { ...eightHours, end_time: '2026-10-01T22:59:00Z' };
    const b = sessionBilling(s, data);
    expect(b.quantityHundredths).toBe(798);
    expect(b.amountCents).toBe(51870);
  });
});

describe('fixed-price jobs (per person, per day)', () => {
  const fixedSession = (over = {}) => ({ id: 'f1', job_id: 'j2', start_time: '2026-10-02T15:00:00Z', end_time: '2026-10-02T23:00:00Z', day_type: 'full', ...over });

  it('bills the full-day job rate per session', () => {
    expect(sessionBilling(fixedSession(), data).amountCents).toBe(75000);
  });

  it('falls back to the company half-day rate only when the job has none', () => {
    expect(sessionBilling(fixedSession({ day_type: 'half' }), data).amountCents).toBe(40000);
  });

  it('a crew of two on a full day bills two full days, and each person shows as a line', () => {
    const a = fixedSession({ id: 'f1' });
    const b = fixedSession({ id: 'f2', employee_id: 'e1' });
    expect(summarize([a, b], data).revenueCents).toBe(150000);
    const lines = buildInvoiceLines([a, b], data, localDateKey);
    expect(lines.map(l => [l.worker_name, l.unit, l.amountCents])).toEqual([[null, 'full_day', 75000], ['Sam', 'full_day', 75000]]);
  });

  it('flags the same worker billed twice for one job on one day', () => {
    const a = fixedSession({ id: 'f1' });
    const b = fixedSession({ id: 'f2', start_time: '2026-10-02T23:30:00Z', end_time: '2026-10-03T00:30:00Z' });
    expect(duplicateFixedBillings([a, b], data, localDateKey).length).toBe(1);
  });

  it('missing day type bills nothing and is flagged', () => {
    expect(sessionBilling(fixedSession({ day_type: null }), data)).toMatchObject({ amountCents: 0, missing: 'day_type' });
  });

  it('an explicit $0 day rate is kept, not replaced by the company default', () => {
    const zero = { ...fixedJob, id: 'j3', full_day_rate: 0 };
    const d = { ...data, jobs: [...data.jobs, zero] };
    expect(sessionBilling(fixedSession({ job_id: 'j3' }), d).amountCents).toBe(0);
    expect(snapshotFor({ job: zero, company, dayType: 'full' }).bill_rate).toBe(0);
  });
});

describe('rate snapshots', () => {
  it('a later rate change does not alter a snapshotted session', () => {
    const snap = { ...eightHours, ...snapshotFor({ job, employee: worker, company }) };
    const raised = { ...data, jobs: [{ ...job, rate: 90 }], employees: [{ ...worker, rate: 55 }] };
    expect(sessionBilling(snap, raised).amountCents).toBe(52000);
    expect(sessionLabourCents(snap, raised)).toBe(32000);
    expect(sessionBilling(snap, raised).legacy).toBe(false);
  });

  it('a session without a snapshot uses current rates and is flagged legacy', () => {
    expect(sessionBilling(eightHours, data).legacy).toBe(true);
  });
});

describe('invoice totals', () => {
  it('GST is rounded once on the subtotal', () => {
    expect(taxCents(52000, 5)).toBe(2600);
    expect(taxCents(1, 5)).toBe(0);    // 0.05 cents -> 0
    expect(taxCents(10, 5)).toBe(1);   // 0.5 cents -> 1 (half up)
    const lines = buildInvoiceLines([eightHours], data, localDateKey);
    expect(totalsFromLines(lines, 5)).toEqual({ subtotalCents: 52000, taxCents: 2600, totalCents: 54600 });
  });

  it('rpc lines carry exact decimal strings', () => {
    const [l] = buildInvoiceLines([eightHours], data, localDateKey);
    expect(toRpcLine(l)).toMatchObject({ quantity: '8.00', unit: 'hour', unit_price: '65.00', amount: '520.00' });
  });

  it('cents conversion avoids float drift', () => {
    expect(toCents('64.99')).toBe(6499);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});
