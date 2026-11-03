// Overtime FLAGS (not payroll). Computed per worker, never by adding up
// different people's hours.
//
// Default rules follow the BC Employment Standards Act as confirmed for this
// business: over 8 h in a day is overtime (1.5×), over 12 h is double time;
// over 40 h in a Sunday–Saturday week counts only hours that were not already
// daily overtime, so nothing is counted twice. Sessions are attributed to the
// local date they start on. Thresholds are configurable.

import { localDateKey, weekStartKey, inRange, addDaysKey } from './time.js';
import { sessionDurationMs } from './billing.js';

export const DEFAULT_OT_RULES = { enabled: true, dailyHours: 8, dailyDoubleHours: 12, weeklyHours: 40, weekStartsOn: 0 };

export const workerKey = s => s.employee_id || 'owner';

export function computeOvertime(sessions, rules = DEFAULT_OT_RULES) {
  const r = { ...DEFAULT_OT_RULES, ...rules };
  const byWorker = {};
  for (const s of sessions) {
    if (!s.end_time) continue;
    const w = workerKey(s);
    const day = localDateKey(s.start_time);
    const bw = (byWorker[w] ||= { days: {}, weeks: {} });
    const d = (bw.days[day] ||= { hours: 0, regular: 0, ot: 0, double: 0 });
    d.hours += sessionDurationMs(s) / 3600000;
  }
  for (const bw of Object.values(byWorker)) {
    for (const [day, d] of Object.entries(bw.days)) {
      d.regular = Math.min(d.hours, r.dailyHours);
      d.double = Math.max(0, d.hours - r.dailyDoubleHours);
      d.ot = Math.max(0, Math.min(d.hours, r.dailyDoubleHours) - r.dailyHours);
      const wk = weekStartKey(day, r.weekStartsOn);
      const w = (bw.weeks[wk] ||= { regular: 0, weeklyOt: 0 });
      w.regular += d.regular;
    }
    for (const w of Object.values(bw.weeks)) w.weeklyOt = Math.max(0, w.regular - r.weeklyHours);
  }
  return byWorker;
}

// Totals for a report range. Weekly overtime is computed on complete weeks
// (from all sessions), and weeks that extend beyond the range are flagged.
export function overtimeForRange(allSessions, range, rules = DEFAULT_OT_RULES) {
  const r = { ...DEFAULT_OT_RULES, ...rules };
  if (!r.enabled) return { enabled: false, workers: [] };
  const byWorker = computeOvertime(allSessions, r);
  const workers = [];
  for (const [worker, bw] of Object.entries(byWorker)) {
    let dailyOt = 0, doubleTime = 0, weeklyOt = 0, otDays = 0, partialWeeks = 0;
    for (const [day, d] of Object.entries(bw.days)) {
      if (!inRange(day, range)) continue;
      dailyOt += d.ot; doubleTime += d.double;
      if (d.ot + d.double > 0) otDays += 1;
    }
    for (const [wk, w] of Object.entries(bw.weeks)) {
      const end = addDaysKey(wk, 6);
      if (end < range[0] || wk > range[1]) continue;
      if (w.weeklyOt > 0) {
        weeklyOt += w.weeklyOt;
        if (wk < range[0] || end > range[1]) partialWeeks += 1;
      }
    }
    if (dailyOt + doubleTime + weeklyOt > 0) workers.push({ worker, dailyOt, doubleTime, weeklyOt, otDays, partialWeeks });
  }
  return { enabled: true, workers };
}

// Daily flag for one worker on one date (calendar and clock views).
export function dayOvertime(allSessions, worker, day, rules = DEFAULT_OT_RULES) {
  const r = { ...DEFAULT_OT_RULES, ...rules };
  if (!r.enabled) return null;
  const d = computeOvertime(allSessions.filter(s => workerKey(s) === worker), r)[worker]?.days[day];
  return d && d.ot + d.double > 0 ? d : null;
}

// Workers with daily overtime on a date.
export function workersWithOvertimeOn(allSessions, day, rules = DEFAULT_OT_RULES) {
  const r = { ...DEFAULT_OT_RULES, ...rules };
  if (!r.enabled) return [];
  const sameDay = allSessions.filter(s => s.end_time && localDateKey(s.start_time) === day);
  const all = computeOvertime(sameDay, r);
  return Object.entries(all)
    .map(([worker, bw]) => ({ worker, ...bw.days[day] }))
    .filter(d => d.ot + d.double > 0);
}
