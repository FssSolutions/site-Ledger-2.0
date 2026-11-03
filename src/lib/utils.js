import { localDateKey } from './time.js';
import { sessionDurationMs } from './billing.js';

export function fmtDur(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Formats a dollar amount (not cents).
export function fmtCAD(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);
}

export const calcDur = sessionDurationMs;
export const dayKey = localDateKey;
export { todayKey as todayStr } from './time.js';
