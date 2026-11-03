// Local-date handling. Calendar dates ('YYYY-MM-DD', e.g. expense and
// mileage dates) are compared as strings and never parsed with new Date(str),
// which treats them as UTC midnight and shifts them to the previous day in
// Vancouver. Timestamps are converted to the device's local calendar date.

const pad = n => String(n).padStart(2, '0');

export function localDateKey(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayKey = (now = new Date()) => localDateKey(now);

// Local midnight at the start of a calendar date.
export function startOfLocalDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysKey(key, days) {
  const d = startOfLocalDate(key);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

// Value for <input type="datetime-local"> in local time.
export function toLocalInputValue(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${localDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localTimeHHMM(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Builds start/end timestamps from a local date and HH:MM times. An end time
// at or before the start is only accepted as "next day" when overnight is
// explicitly chosen.
export function combineLocal(dateKey, startHHMM, endHHMM, { overnight = false } = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const start = new Date(y, m - 1, d, sh, sm);
  const end = new Date(y, m - 1, d + (overnight ? 1 : 0), eh, em);
  return { start, end };
}

export const MAX_SESSION_MS = 24 * 3600 * 1000;

export function validateSessionTimes(start, end, breakSeconds = 0) {
  const s = start instanceof Date ? start.getTime() : Date.parse(start);
  const e = end instanceof Date ? end.getTime() : Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Enter a valid start and end time.';
  if (e <= s) return 'End time must be after start time.';
  if (e - s > MAX_SESSION_MS) return 'A single entry cannot be longer than 24 hours.';
  if (breakSeconds * 1000 >= e - s) return 'Break time must be shorter than the entry.';
  return null;
}

// Report ranges as inclusive local date keys.
export function presetRange(preset, now = new Date(), custom = {}) {
  const t = localDateKey(now);
  if (preset === 'week') return [addDaysKey(t, -6), t];
  if (preset === 'month') return [`${t.slice(0, 7)}-01`, t];
  if (preset === 'lastmonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return [localDateKey(first), localDateKey(last)];
  }
  if (preset === 'year') return [`${t.slice(0, 4)}-01-01`, t];
  if (preset === 'custom' && custom.start && custom.end) return [custom.start, custom.end];
  return ['0000-01-01', '9999-12-31'];
}

export const inRange = (key, [a, b]) => key >= a && key <= b;
export const sessionInRange = (s, range) => inRange(localDateKey(s.start_time), range);

// Start of the work week containing `key` (weekStartsOn: 0 = Sunday).
export function weekStartKey(key, weekStartsOn = 0) {
  const d = startOfLocalDate(key);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return localDateKey(d);
}
