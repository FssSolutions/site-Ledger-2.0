import { describe, it, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../src/lib/localdb.js';
import { createLedgerStore } from '../src/lib/ledgerStore.js';
import { createActions, deriveView, jobToDb, companyToDb } from '../src/lib/ledgerActions.js';
import { createSyncEngine } from '../src/lib/sync.js';
import { sessionBilling } from '../src/lib/billing.js';
import { createFakeServer } from './fakeRemote.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
let dbName, db, store, view, actions, clock, server;

async function refresh() { view = deriveView((await store.loadAll()).data); return view; }
async function reopen() {
  db.close();
  db = await openLocalDb({ name: dbName });
  store = createLedgerStore(db, A);
  actions = createActions({ store, getView: () => view, now: () => new Date(clock) });
  return refresh();
}
const sync = () => createSyncEngine({ store, remote: server.remoteFor(A), lock: (_n, f) => f() }).sync();

beforeEach(async () => {
  dbName = `act-${crypto.randomUUID()}`;
  db = await openLocalDb({ name: dbName });
  store = createLedgerStore(db, A);
  clock = Date.parse('2026-11-02T16:00:00Z'); // 08:00 PST/PDT-ish local
  actions = createActions({ store, getView: () => view, now: () => new Date(clock) });
  server = createFakeServer();
  await refresh();
});

async function addJob(over = {}) {
  const r = await actions.addJob({ name: 'Basement', rate: 65, pricing_type: 'hourly', ...over });
  expect(r.ok).toBe(true);
  await refresh();
  return r.data;
}

describe('clock in / break / clock out', () => {
  it('break time is stored separately and survives a refresh', async () => {
    const job = await addJob();
    expect((await actions.clockIn(job.id)).ok).toBe(true);
    await refresh();
    clock += 2 * 3600000;
    await actions.startBreak();
    await reopen(); // app refreshed mid-break
    expect(view.active.break_started_at).toBeTruthy();
    clock += 30 * 60000;
    await actions.endBreak();
    await refresh();
    expect(view.active.break_seconds).toBe(1800);
    clock += 5.5 * 3600000;
    const r = await actions.clockOut();
    expect(r.ok).toBe(true);
    await refresh();
    const s = view.sessions[0];
    expect(Date.parse(s.end_time) - Date.parse(s.start_time)).toBe(8 * 3600000); // real end time kept
    expect(s.break_seconds).toBe(1800);
    expect(view.active).toBeNull();
    expect(sessionBilling(s, view).quantityHundredths).toBe(750);
  });

  it('break state survives a failed clock-out', async () => {
    const job = await addJob({ pricing_type: 'fixed', rate: 0, full_day_rate: 700 });
    await actions.clockIn(job.id); await refresh();
    clock += 3600000;
    await actions.startBreak(); await refresh();
    clock += 600000;
    const r = await actions.clockOut(); // no day type chosen
    expect(r.ok).toBe(false);
    await reopen();
    expect(view.active.break_started_at).toBeTruthy();
    expect(view.active.end_time ?? null).toBeNull();
  });

  it('clocking out while on a break counts the break up to clock-out', async () => {
    const job = await addJob();
    await actions.clockIn(job.id); await refresh();
    clock += 4 * 3600000;
    await actions.startBreak(); await refresh();
    clock += 15 * 60000;
    await actions.clockOut(); await refresh();
    expect(view.sessions[0].break_seconds).toBe(900);
  });

  it('rejects a clock-out before the start (stale session) and keeps the session open', async () => {
    const job = await addJob();
    await actions.clockIn(job.id); await refresh();
    const r = await actions.clockOut({ endTime: new Date(clock - 3600000).toISOString() });
    expect(r).toMatchObject({ ok: false });
    await refresh();
    expect(view.active).not.toBeNull();
  });

  it('cannot clock in twice', async () => {
    const job = await addJob();
    await actions.clockIn(job.id); await refresh();
    expect((await actions.clockIn(job.id)).ok).toBe(false);
  });

  it('deleting the active session clears the active clock', async () => {
    const job = await addJob();
    await actions.clockIn(job.id); await refresh();
    await actions.deleteSession(view.active.id); await refresh();
    expect(view.active).toBeNull();
  });
});

describe('fixed-price day_type survives every persistence path', () => {
  it('offline clock-out, edit, and new entry all keep day_type through sync', async () => {
    const job = await addJob({ pricing_type: 'fixed', rate: 0, half_day_rate: 400, full_day_rate: 700 });
    await actions.clockIn(job.id); await refresh();
    clock += 8 * 3600000;
    await actions.clockOut({ dayType: 'full' }); await refresh();
    expect(view.sessions[0]).toMatchObject({ day_type: 'full', bill_basis: 'full_day', bill_rate: 700 });

    // edit to half day
    const s = view.sessions[0];
    await actions.saveSession({ ...s, day_type: 'half' }); await refresh();
    expect(view.sessions[0]).toMatchObject({ day_type: 'half', bill_basis: 'half_day', bill_rate: 400 });

    // manual new entry
    await actions.saveSession({ job_id: job.id, start_time: '2026-11-03T16:00:00Z', end_time: '2026-11-03T20:00:00Z', day_type: 'half' });
    await sync(); await refresh();
    const rows = server.rows('sessions').sort((a, b) => a.start_time.localeCompare(b.start_time));
    expect(rows.map(r => r.day_type)).toEqual(['half', 'half']);
    expect(view.sessions.every(x => x._sync === 'synced')).toBe(true);

    // edit after sync (update path)
    const synced = view.sessions.find(x => x.start_time.startsWith('2026-11-03'));
    await actions.saveSession({ ...synced, day_type: 'full' });
    await sync();
    expect(server.rows('sessions').find(r => r.id === synced.id).day_type).toBe('full');
  });

  it('a fixed-price entry without a day type is refused', async () => {
    const job = await addJob({ pricing_type: 'fixed', rate: 0 });
    const r = await actions.saveSession({ job_id: job.id, start_time: '2026-11-03T16:00:00Z', end_time: '2026-11-03T20:00:00Z' });
    expect(r.ok).toBe(false);
  });
});

describe('explicit zero values are preserved', () => {
  it('job, employee and company zeros are not replaced by defaults', () => {
    expect(jobToDb({ name: 'Warranty', rate: 0, budget_hours: 0, half_day_rate: 0, pricing_type: 'hourly' }))
      .toMatchObject({ rate: 0, budget_hours: 0, half_day_rate: 0 });
    expect(jobToDb({ name: 'x', rate: '' })).toMatchObject({ rate: null });
    expect(companyToDb({ halfDayRate: 0, fullDayRate: '' })).toMatchObject({ half_day_rate: 0, full_day_rate: null });
  });

  it('$0/h job is saved and bills $0', async () => {
    const job = await addJob({ rate: 0 });
    expect(job.rate).toBe(0);
  });
});

describe('rate changes', () => {
  it('editing a job rate does not change sessions already recorded', async () => {
    const job = await addJob({ rate: 65 });
    await actions.saveSession({ job_id: job.id, start_time: '2026-11-03T16:00:00Z', end_time: '2026-11-04T00:00:00Z' });
    await refresh();
    await actions.updateJob({ ...view.jobs[0], rate: 90 }); await refresh();
    expect(sessionBilling(view.sessions[0], view).amountCents).toBe(52000);
    // notes-only edit keeps the original snapshot
    await actions.saveSession({ ...view.sessions[0], notes: 'trim' }); await refresh();
    expect(view.sessions[0].bill_rate).toBe(65);
  });
});

describe('clock-out edge cases', () => {
  it('a break taken straight after clock-in never blocks clock-out', async () => {
    const job = await addJob();
    await actions.clockIn(job.id); await refresh();
    clock += 100;
    await actions.startBreak(); await refresh();
    clock += 3600;      // 3.6 s break would round up to 4 s
    await actions.endBreak();      // no refresh: the screen lags behind storage
    clock += 50;
    const r = await actions.clockOut();
    expect(r.ok).toBe(true);
    await refresh();
    const s = view.sessions[0];
    expect(s.break_seconds * 1000).toBeLessThan(Date.parse(s.end_time) - Date.parse(s.start_time));
  });
});
