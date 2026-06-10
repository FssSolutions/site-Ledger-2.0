import { CRA_RATE } from './constants.js';

export function fmtDur(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtCAD(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}

export function calcEarnings(s, jobs, employees = []) {
  if (!s.end_time) return 0;
  const hrs = (new Date(s.end_time) - new Date(s.start_time)) / 3600000;
  if (s.employee_id) {
    const emp = employees.find(e => e.id === s.employee_id);
    if (emp) return hrs * emp.rate;
  }
  const j = jobs.find(x => x.id === s.job_id);
  return j ? hrs * j.rate : 0;
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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ISO week number for a date
export function getISOWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return `${date.getFullYear()}-W${String(1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
}

// Returns { daily: { 'YYYY-MM-DD': { total (hrs), overtime (hrs) } }, weekly: { 'YYYY-WNN': { total, overtime } } }
export function calcOvertime(sessions, dailyLimit = 8, weeklyLimit = 44) {
  const daily = {};
  const weekly = {};

  sessions.forEach(s => {
    if (!s.end_time) return;
    const hrs = calcDur(s) / 3600000;
    const dk = dayKey(s.start_time);
    const wk = getISOWeek(new Date(s.start_time));

    if (!daily[dk]) daily[dk] = { total: 0, overtime: 0 };
    daily[dk].total += hrs;

    if (!weekly[wk]) weekly[wk] = { total: 0, overtime: 0 };
    weekly[wk].total += hrs;
  });

  Object.values(daily).forEach(d => { d.overtime = Math.max(0, d.total - dailyLimit); });
  Object.values(weekly).forEach(w => { w.overtime = Math.max(0, w.total - weeklyLimit); });

  return { daily, weekly };
}
