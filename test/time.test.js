// Runs with TZ=America/Vancouver (vitest.config.js).
import { describe, it, expect } from 'vitest';
import { localDateKey, presetRange, sessionInRange, inRange, combineLocal, validateSessionTimes, weekStartKey } from '../src/lib/time.js';
import { computeOvertime, overtimeForRange, workersWithOvertimeOn } from '../src/lib/overtime.js';
import { mileageEstimates, ratesForYear } from '../src/lib/mileage.js';

describe('Vancouver local dates', () => {
  it('runs in America/Vancouver', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Vancouver');
  });

  it('an evening session belongs to its local day, not the UTC day', () => {
    // 2026-10-31 20:00 PDT = 2026-11-01 03:00 UTC
    expect(localDateKey('2026-11-01T03:00:00Z')).toBe('2026-10-31');
  });

  it('month boundaries: Oct 31 evening is October, Nov 1 morning is November', () => {
    const now = new Date(2026, 10, 15, 12); // Nov 15 local
    const nov = presetRange('month', now);
    expect(nov).toEqual(['2026-11-01', '2026-11-15']);
    expect(sessionInRange({ start_time: '2026-11-01T03:00:00Z' }, nov)).toBe(false); // Oct 31 20:00 PDT
    expect(sessionInRange({ start_time: '2026-11-01T15:00:00Z' }, nov)).toBe(true);  // Nov 1 08:00 PDT
    expect(presetRange('lastmonth', now)).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('expense/mileage dates are compared as calendar dates (no UTC shift)', () => {
    // new Date('2026-11-01') would be Oct 31 17:00 in Vancouver
    expect(inRange('2026-11-01', ['2026-11-01', '2026-11-30'])).toBe(true);
    expect(inRange('2026-10-31', ['2026-11-01', '2026-11-30'])).toBe(false);
  });

  it('DST end (Nov 2 2025): an overnight shift across the fall-back is 9 real hours', () => {
    const night = combineLocal('2025-11-01', '22:00', '06:00', { overnight: true });
    expect(night.end - night.start).toBe(9 * 3600000);
    const day = combineLocal('2025-11-02', '08:00', '16:00');
    expect(day.end - day.start).toBe(8 * 3600000);
    expect(localDateKey(day.start)).toBe('2025-11-02');
  });

  it('follows the platform time-zone rules instead of hard-coded offsets', () => {
    // BC moved to permanent UTC-7 (tzdata 2026e has no Nov 2026 fall-back).
    // Whatever the rules say, duration = wall-clock difference + offset change.
    const night = combineLocal('2026-10-31', '22:00', '06:00', { overnight: true });
    const offsetShiftMs = (night.end.getTimezoneOffset() - night.start.getTimezoneOffset()) * 60000;
    expect(night.end - night.start).toBe(8 * 3600000 + offsetShiftMs);
    expect(localDateKey(night.start)).toBe('2026-10-31');
  });

  it('DST start (Mar 8 2026): 00:00-08:00 is 7 real hours', () => {
    const { start, end } = combineLocal('2026-03-08', '00:00', '08:00');
    expect(end - start).toBe(7 * 3600000);
  });

  it('end before start is rejected unless overnight is chosen', () => {
    const same = combineLocal('2026-10-01', '22:00', '06:00');
    expect(validateSessionTimes(same.start, same.end)).toMatch(/after start/);
    const night = combineLocal('2026-10-01', '22:00', '06:00', { overnight: true });
    expect(validateSessionTimes(night.start, night.end)).toBeNull();
  });

  it('weeks start on Sunday', () => {
    expect(weekStartKey('2026-11-04')).toBe('2026-11-01'); // Wed -> Sun
    expect(weekStartKey('2026-11-01')).toBe('2026-11-01');
  });
});

const sess = (id, emp, startLocal, hours) => {
  const s = new Date(startLocal);
  return { id, employee_id: emp, start_time: s.toISOString(), end_time: new Date(s.getTime() + hours * 3600000).toISOString() };
};

describe('overtime flags (BC rules, per worker)', () => {
  it('two employees working six hours each do not create daily overtime', () => {
    const s = [sess('a', 'e1', '2026-11-02T08:00', 6), sess('b', 'e2', '2026-11-02T08:00', 6)];
    expect(workersWithOvertimeOn(s, '2026-11-02')).toEqual([]);
    expect(overtimeForRange(s, ['2026-11-01', '2026-11-30']).workers).toEqual([]);
  });

  it('one worker over 8 h gets 1.5x hours, over 12 h double time', () => {
    const s = [sess('a', 'e1', '2026-11-02T06:00', 13)];
    const d = computeOvertime(s).e1.days['2026-11-02'];
    expect(d).toMatchObject({ regular: 8, ot: 4, double: 1 });
  });

  it('daily and weekly overtime are not double counted', () => {
    // 5 x 10 h days: 10 h daily OT; regular = 40, so no weekly OT on top.
    const s = [2, 3, 4, 5, 6].map(d => sess(`d${d}`, 'e1', `2026-11-0${d}T07:00`, 10));
    const r = overtimeForRange(s, ['2026-11-01', '2026-11-07']);
    expect(r.workers).toEqual([{ worker: 'e1', dailyOt: 10, doubleTime: 0, weeklyOt: 0, otDays: 5, partialWeeks: 0 }]);
  });

  it('weekly overtime from six 8 h days', () => {
    const s = [1, 2, 3, 4, 5, 6].map(d => sess(`d${d}`, 'e1', `2026-11-0${d}T07:00`, 8));
    expect(overtimeForRange(s, ['2026-11-01', '2026-11-07']).workers[0]).toMatchObject({ dailyOt: 0, weeklyOt: 8 });
  });

  it('weekly overtime is computed on the complete week and flagged when the range cuts it', () => {
    const s = [1, 2, 3, 4, 5, 6].map(d => sess(`d${d}`, 'e1', `2026-11-0${d}T07:00`, 8));
    const r = overtimeForRange(s, ['2026-11-04', '2026-11-30']).workers[0];
    expect(r.weeklyOt).toBe(8);
    expect(r.partialWeeks).toBe(1);
  });
});

describe('mileage estimate', () => {
  it('is year-aware and tiered at 5,000 km', () => {
    const trips = [
      { id: 't1', date: '2025-03-01', km: 4990 },
      { id: 't2', date: '2025-06-01', km: 20 },   // 10 km at first tier, 10 km after
      { id: 't3', date: '2026-01-02', km: 10 },   // new year resets the tier
    ];
    const e = mileageEstimates(trips);
    expect(e.t1.cents).toBe(Math.round(4990 * 72));
    expect(e.t2.cents).toBe(10 * 72 + 10 * 66);
    expect(e.t3.cents).toBe(720);
    expect(e.t3.verified).toBe(false);
  });

  it('unknown future years are marked unverified', () => {
    expect(ratesForYear(2030)).toMatchObject({ verified: false, carriedFrom: 2026 });
  });
});
