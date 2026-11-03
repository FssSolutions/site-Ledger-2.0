// Pure input/output validation for the voice-entry function. No Deno APIs, so
// it is unit-tested with vitest (validate.test.ts).

export const LIMITS = {
  audioBytes: 5 * 1024 * 1024,   // ~90 s of compressed speech is far smaller
  jobs: 200,
  customers: 500,
  nameChars: 120,
  addressChars: 200,
  idChars: 64,
  elapsedSeconds: 600,
  clockSkewMs: 36 * 3600 * 1000,
  maxEntryHours: 16,
};

export class InputError extends Error {}

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseJsonList(raw: unknown, max: number): unknown[] {
  if (raw == null || raw === '') return [];
  if (typeof raw !== 'string' || raw.length > 200_000) throw new InputError('Invalid list.');
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new InputError('Invalid list.'); }
  if (!Array.isArray(v)) throw new InputError('Invalid list.');
  if (v.length > max) throw new InputError('Too many items.');
  return v;
}

export function cleanJobs(list: unknown[]) {
  return list
    .filter((j: any) => j && typeof j.id === 'string' && ID_RE.test(j.id))
    .map((j: any) => ({ id: j.id, name: str(j.name, LIMITS.nameChars), address: str(j.address, LIMITS.addressChars) }));
}

export function cleanCustomers(list: unknown[]) {
  return list
    .filter((c: any) => c && typeof c.id === 'string' && ID_RE.test(c.id))
    .map((c: any) => ({ id: c.id, name: str(c.name, LIMITS.nameChars) }));
}

export function validTimezone(tz: unknown): string {
  if (typeof tz !== 'string' || tz.length > 64) return 'America/Vancouver';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; } catch { return 'America/Vancouver'; }
}

export function validNow(raw: unknown, serverNow = Date.now()): string {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t) || Math.abs(t - serverNow) > LIMITS.clockSkewMs) return new Date(serverNow).toISOString();
  return new Date(t).toISOString();
}

export function validDefaultStart(raw: unknown): string {
  return typeof raw === 'string' && TIME_RE.test(raw) ? raw : '08:00';
}

export function validElapsed(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= LIMITS.elapsedSeconds ? Math.round(n) : null;
}

function validDate(d: unknown): string | null {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return null;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day ? d : null;
}
const validTime = (t: unknown) => (typeof t === 'string' && TIME_RE.test(t) ? t : null);
const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// Sanitises the model's output: ids must come from the lists we sent,
// values must be well-formed, and anything doubtful becomes a warning for
// the user to review before saving.
export function sanitizeEntry(e: any, jobIds: Set<string>) {
  const warnings: string[] = Array.isArray(e?.warnings) ? e.warnings.filter((w: unknown) => typeof w === 'string').slice(0, 5).map((w: string) => w.slice(0, 200)) : [];
  const assumptions: string[] = Array.isArray(e?.assumptions) ? e.assumptions.filter((w: unknown) => typeof w === 'string').slice(0, 5).map((w: string) => w.slice(0, 200)) : [];
  let jobId = typeof e?.job_id === 'string' && jobIds.has(e.job_id) ? e.job_id : null;
  if (e?.job_id && !jobId) warnings.push('The suggested job is not one of your active jobs. Choose the job.');
  let duration = typeof e?.duration_hours === 'number' && Number.isFinite(e.duration_hours) ? e.duration_hours : null;
  if (duration != null && (duration <= 0 || duration > LIMITS.maxEntryHours)) {
    warnings.push(`A duration of ${duration} hours looks wrong; check the times.`);
    duration = null;
  }
  return {
    job_id: jobId,
    job_name_guess: str(e?.job_name_guess, LIMITS.nameChars) || null,
    date: validDate(e?.date),
    start_time: validTime(e?.start_time),
    end_time: validTime(e?.end_time),
    duration_hours: duration,
    notes: str(e?.notes, 1000),
    assumptions,
    warnings,
    confidence: {
      job: clamp01(e?.confidence?.job), date: clamp01(e?.confidence?.date),
      time: clamp01(e?.confidence?.time), notes: clamp01(e?.confidence?.notes),
    },
  };
}

export function sanitizeInvoiceRequest(r: any, jobIds: Set<string>, customerIds: Set<string>) {
  return {
    customer_id: typeof r?.customer_id === 'string' && customerIds.has(r.customer_id) ? r.customer_id : null,
    customer_name_guess: str(r?.customer_name_guess, LIMITS.nameChars) || null,
    date_range_start: validDate(r?.date_range_start),
    date_range_end: validDate(r?.date_range_end),
    job_ids: Array.isArray(r?.job_ids) ? [...new Set(r.job_ids.filter((j: unknown) => typeof j === 'string' && jobIds.has(j as string)))].slice(0, 50) : [],
    job_name_guesses: Array.isArray(r?.job_name_guesses) ? r.job_name_guesses.filter((j: unknown) => typeof j === 'string').slice(0, 10).map((j: string) => j.slice(0, LIMITS.nameChars)) : [],
  };
}

export function addHours(time: string, hours: number) {
  const [h, m] = time.split(':').map(Number);
  const end = h * 60 + m + Math.round(hours * 60);
  const endH = Math.floor(end / 60) % 24;
  return `${String(endH).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export function localDateKey(nowIso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowIso));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Turns a sanitised entry into a session draft for the review screen.
export function buildSession(entry: ReturnType<typeof sanitizeEntry>, ctx: { now: string; timezone: string; defaultStart: string }) {
  const warnings = [...entry.warnings];
  const assumptions = [...entry.assumptions];
  const date = entry.date || localDateKey(ctx.now, ctx.timezone);
  let start = entry.start_time;
  let end = entry.end_time;
  if (!entry.date) assumptions.push('No date was stated, so today was used.');
  if ((!start || !end) && entry.duration_hours) {
    start = start || ctx.defaultStart;
    end = addHours(start, entry.duration_hours);
    assumptions.push(`Only a duration was stated, so ${start}-${end} was used.`);
  }
  if (!start || !end) warnings.push('No clear hours were found. Review the times before saving.');
  if (!entry.job_id) warnings.push('No confident job match was found. Choose the job before saving.');
  return {
    session: {
      job_id: entry.job_id,
      start_time: start && end ? `${date}T${start}:00` : undefined,
      end_time: start && end ? `${date}T${end}:00` : undefined,
      notes: entry.notes,
    },
    assumptions,
    warnings,
  };
}
