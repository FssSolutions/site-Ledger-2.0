import { CRA_RATE } from './constants.js';

export function fmtDur(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtCAD(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}

export function calcEarnings(s, jobs) {
  const j = jobs.find(x => x.id === s.job_id);
  if (!j || !s.end_time) return 0;
  return ((new Date(s.end_time) - new Date(s.start_time)) / 3600000) * j.rate;
}

export function calcDur(s) {
  if (!s.end_time) return 0;
  return new Date(s.end_time) - new Date(s.start_time);
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
