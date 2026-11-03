import { describe, it, expect } from 'vitest';
import {
  parseJsonList, cleanJobs, validTimezone, validNow, validDefaultStart, validElapsed,
  sanitizeEntry, sanitizeInvoiceRequest, buildSession, InputError, LIMITS,
} from './validate.ts';

describe('voice-entry input validation', () => {
  it('bounds list sizes and rejects malformed JSON', () => {
    expect(() => parseJsonList('not json', 10)).toThrow(InputError);
    expect(() => parseJsonList(JSON.stringify(new Array(LIMITS.jobs + 1).fill({})), LIMITS.jobs)).toThrow(InputError);
    expect(parseJsonList(null, 10)).toEqual([]);
  });

  it('keeps only well-formed job ids and truncates text', () => {
    const jobs = cleanJobs([{ id: 'a1b2-c3', name: 'x'.repeat(500) }, { id: 'bad id; drop', name: 'y' }, { id: 5 }]);
    expect(jobs.map(j => j.id)).toEqual(['a1b2-c3']);
    expect(jobs[0].name.length).toBe(LIMITS.nameChars);
  });

  it('validates metadata', () => {
    expect(validTimezone('Not/AZone')).toBe('America/Vancouver');
    expect(validTimezone('America/Toronto')).toBe('America/Toronto');
    const server = Date.parse('2026-11-03T12:00:00Z');
    expect(validNow('2020-01-01T00:00:00Z', server)).toBe('2026-11-03T12:00:00.000Z');
    expect(validNow('2026-11-03T11:00:00Z', server)).toBe('2026-11-03T11:00:00.000Z');
    expect(validDefaultStart('25:00')).toBe('08:00');
    expect(validElapsed('99999')).toBeNull();
    expect(validElapsed('42')).toBe(42);
  });
});

describe('voice-entry output validation', () => {
  const jobIds = new Set(['job-1']);

  it('drops job ids that were not offered and flags it', () => {
    const e = sanitizeEntry({ job_id: 'someone-elses-job', date: '2026-11-03', start_time: '08:00', end_time: '16:00' }, jobIds);
    expect(e.job_id).toBeNull();
    expect(e.warnings.join(' ')).toMatch(/not one of your active jobs/);
  });

  it('rejects malformed dates, times and absurd durations', () => {
    const e = sanitizeEntry({ job_id: 'job-1', date: '2026-02-30', start_time: '8am', end_time: '24:00', duration_hours: 40 }, jobIds);
    expect(e).toMatchObject({ date: null, start_time: null, end_time: null, duration_hours: null });
    expect(e.warnings.join(' ')).toMatch(/40 hours looks wrong/);
  });

  it('builds a draft from a duration and marks assumptions', () => {
    const e = sanitizeEntry({ job_id: 'job-1', date: '2026-11-03', duration_hours: 8, notes: 'framing' }, jobIds);
    const d = buildSession(e, { now: '2026-11-03T18:00:00Z', timezone: 'America/Vancouver', defaultStart: '08:00' });
    expect(d.session).toMatchObject({ job_id: 'job-1', start_time: '2026-11-03T08:00:00', end_time: '2026-11-03T16:00:00' });
    expect(d.assumptions.join(' ')).toMatch(/Only a duration/);
  });

  it('filters invoice-request ids to the lists that were sent', () => {
    const r = sanitizeInvoiceRequest({ customer_id: 'x', job_ids: ['job-1', 'job-9', 'job-1'], date_range_start: '2026-10-01', date_range_end: 'soon' }, jobIds, new Set(['c1']));
    expect(r).toMatchObject({ customer_id: null, job_ids: ['job-1'], date_range_start: '2026-10-01', date_range_end: null });
  });
});
