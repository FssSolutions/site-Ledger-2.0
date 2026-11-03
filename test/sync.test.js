import { describe, it, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../src/lib/localdb.js';
import { createLedgerStore, accountsWithPendingWork } from '../src/lib/ledgerStore.js';
import { createSyncEngine, backoffDelay } from '../src/lib/sync.js';
import { createFakeServer } from './fakeRemote.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const noLock = (_n, fn) => fn();

let db, server, clock;
beforeEach(async () => {
  db = await openLocalDb({ name: `test-${crypto.randomUUID()}` });
  server = createFakeServer();
  clock = 1_000_000;
});
const now = () => clock;
const storeFor = uid => createLedgerStore(db, uid, { now });
const engineFor = (store, remote = server.remoteFor(store.uid)) =>
  createSyncEngine({ store, remote, lock: noLock, now, onStatus: () => {} });

describe('account isolation', () => {
  it("never shows or syncs account A's records and changes under account B", async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'A private job', rate: 65 });
    await a.create('customers', { name: 'A customer' });

    const b = storeFor(B);
    const bView = await b.loadAll();
    expect(bView.data.jobs).toEqual([]);
    expect(bView.data.customers).toEqual([]);
    expect(bView.ops).toEqual([]);

    // B syncs: nothing of A's is sent.
    const bRemote = server.remoteFor(B);
    await engineFor(b, bRemote).sync();
    expect(bRemote.calls).toEqual([]);
    expect(server.rows('jobs')).toEqual([]);

    // A's work is still pending under A, and uploads under A only.
    expect((await a.listOps()).length).toBe(2);
    await engineFor(a).sync();
    expect(server.rows('jobs').map(r => r.user_id)).toEqual([A]);
    expect(server.rows('customers').map(r => r.user_id)).toEqual([A]);
  });

  it('records the owner on every operation and cannot be re-owned by the syncing account', async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'J', rate: 10, user_id: B }); // caller cannot spoof owner
    const [op] = await a.listOps();
    expect(op.uid).toBe(A);
    expect(op.row.user_id).toBe(A);
    // Even if B's engine were handed A's store, the server rejects it and the work stays pending.
    const wrong = engineFor(a, server.remoteFor(B));
    await wrong.sync();
    expect(server.rows('jobs')).toEqual([]);
    const [after] = await a.listOps();
    expect(after.status).toBe('error');
    expect(after.uid).toBe(A);
  });

  it('pull never stores rows belonging to another account', async () => {
    const a = storeFor(A);
    await a.applyPull('jobs', [{ id: 'x', user_id: B, name: 'not mine', version: 1 }], now());
    expect((await a.loadAll()).data.jobs).toEqual([]);
  });

  it('lists accounts that still have pending work on this device', async () => {
    const a = storeFor(A);
    await a.setMeta('account', { email: 'a@example.test' });
    await a.create('jobs', { name: 'J', rate: 1 });
    expect(await accountsWithPendingWork(db)).toEqual([{ uid: A, email: 'a@example.test', pending: 1 }]);
  });

  it('refuses to clear an account cache while changes are pending', async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'J', rate: 1 });
    expect(await a.clearCache()).toBe(false);
    expect((await a.loadAll()).data.jobs.length).toBe(1);
    await engineFor(a).sync();
    expect(await a.clearCache()).toBe(true);
    expect((await a.loadAll()).data.jobs.length).toBe(0);
  });
});

describe('offline editing', () => {
  it('offline clock-in then clock-out produces exactly one completed session', async () => {
    const a = storeFor(A);
    const job = await a.create('jobs', { name: 'J', rate: 65 });
    const s = await a.create('sessions', { job_id: job.id, start_time: '2026-11-02T16:00:00.000Z', break_seconds: 0 });
    await a.update('sessions', s.id, { break_started_at: '2026-11-02T20:00:00.000Z' });
    await a.update('sessions', s.id, { break_started_at: null, break_seconds: 1800 });
    await a.update('sessions', s.id, { end_time: '2026-11-03T00:30:00.000Z' });

    const ops = await a.listOps();
    expect(ops.filter(o => o.table === 'sessions').length).toBe(1);

    const remote = server.remoteFor(A);
    await engineFor(a, remote).sync();
    const rows = server.rows('sessions');
    expect(rows.length).toBe(1);
    expect(rows[0].end_time).toBe('2026-11-03T00:30:00.000Z');
    expect(rows[0].break_seconds).toBe(1800);
    expect(remote.calls.filter(c => c[1] === 'sessions')).toEqual([['insert', 'sessions', s.id]]);
  });

  it('keeps references when a job and its sessions, expenses and mileage are created offline', async () => {
    const a = storeFor(A);
    const job = await a.create('jobs', { name: 'New basement job', rate: 70 });
    await a.create('sessions', { job_id: job.id, start_time: '2026-11-02T16:00:00Z', end_time: '2026-11-02T20:00:00Z' });
    await a.create('expenses', { job_id: job.id, date: '2026-11-02', description: 'screws', amount: 12.5 });
    await a.create('mileage', { job_id: job.id, date: '2026-11-02', km: 30 });
    await engineFor(a).sync();
    expect(server.rows('jobs').map(j => j.id)).toEqual([job.id]);
    expect(server.rows('sessions')[0].job_id).toBe(job.id);
    expect(server.rows('expenses')[0].job_id).toBe(job.id);
    expect(server.rows('mileage')[0].job_id).toBe(job.id);
    expect((await a.listOps()).length).toBe(0);
  });

  it('holds back children while their parent job has failed to sync', async () => {
    const a = storeFor(A);
    const job = await a.create('jobs', { name: 'J', rate: 70 });
    await a.create('sessions', { job_id: job.id, start_time: '2026-11-02T16:00:00Z', end_time: '2026-11-02T20:00:00Z' });
    server.fault('reject');
    const remote = server.remoteFor(A);
    await engineFor(a, remote).sync();
    // job rejected; the session was not even attempted
    expect(remote.calls).toEqual([['insert', 'jobs', job.id]]);
    const ops = await a.listOps();
    expect(ops.map(o => [o.table, o.status])).toEqual([['jobs', 'error'], ['sessions', 'pending']]);
    // user retries the job: both go through
    await a.retry(ops[0].opId);
    await engineFor(a, remote).sync();
    expect(server.rows('sessions').length).toBe(1);
  });

  it('editing and deleting records that never synced', async () => {
    const a = storeFor(A);
    const e = await a.create('expenses', { date: '2026-11-02', description: 'x', amount: 5 });
    await a.update('expenses', e.id, { amount: 7 });
    expect((await a.listOps()).length).toBe(1);
    await a.remove('expenses', e.id);
    expect((await a.listOps()).length).toBe(0);
    expect((await a.loadAll()).data.expenses).toEqual([]);
    const remote = server.remoteFor(A);
    await engineFor(a, remote).sync();
    expect(remote.calls).toEqual([]);
  });

  it('survives a refresh: reopening storage shows the same pending work', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const db1 = await openLocalDb({ name });
    const s1 = createLedgerStore(db1, A, { now });
    const m = await s1.create('mileage', { date: '2026-11-02', km: 12 });
    db1.close();
    const db2 = await openLocalDb({ name });
    const s2 = createLedgerStore(db2, A, { now });
    const view = await s2.loadAll();
    expect(view.data.mileage.map(r => r.id)).toEqual([m.id]);
    expect(view.data.mileage[0]._sync).toBe('pending');
    expect(view.ops.length).toBe(1);
  });

  it('edit and delete of synced records, then reconnect', async () => {
    const a = storeFor(A);
    const c = await a.create('customers', { name: 'C', phone: '1' });
    await engineFor(a).sync();
    await a.update('customers', c.id, { phone: '2' });
    await a.update('customers', c.id, { email: 'c@example.test' });
    expect((await a.listOps()).length).toBe(1); // coalesced, unsent
    server.fault('network');
    await engineFor(a).sync();
    expect((await a.listOps())[0].status).toBe('pending');
    clock += 10 * 60 * 1000;
    await engineFor(a).sync();
    expect(server.rows('customers')[0]).toMatchObject({ phone: '2', email: 'c@example.test', version: 2 });
    await a.remove('customers', c.id);
    expect((await a.loadAll()).data.customers).toEqual([]);
    await engineFor(a).sync();
    expect(server.rows('customers')).toEqual([]);
  });
});

describe('failure handling', () => {
  it('server committed but the response was lost: retry does not duplicate', async () => {
    const a = storeFor(A);
    const s = await a.create('sessions', { start_time: '2026-11-02T16:00:00Z', end_time: '2026-11-02T20:00:00Z' });
    server.fault('lose-response');
    await engineFor(a).sync();
    expect(server.rows('sessions').length).toBe(1);
    const [op] = await a.listOps();
    expect(op.attempts).toBe(1);
    expect(op.status).toBe('pending');
    clock += 10 * 60 * 1000;
    await engineFor(a).sync();
    expect(server.rows('sessions').length).toBe(1);
    expect(server.rows('sessions')[0].id).toBe(s.id);
    expect((await a.listOps()).length).toBe(0);
  });

  it('lost response on an update is recognised as applied, not as a conflict', async () => {
    const a = storeFor(A);
    const j = await a.create('jobs', { name: 'J', rate: 60 });
    await engineFor(a).sync();
    await a.update('jobs', j.id, { rate: 65 });
    server.fault('lose-response');
    await engineFor(a).sync();
    clock += 10 * 60 * 1000;
    await engineFor(a).sync();
    expect((await a.listOps()).length).toBe(0);
    expect(server.rows('jobs')[0].rate).toBe(65);
  });

  it('edits made after a change may have been sent become a separate change', async () => {
    const a = storeFor(A);
    const j = await a.create('jobs', { name: 'J', rate: 60 });
    server.fault('lose-response');
    await engineFor(a).sync();
    await a.update('jobs', j.id, { rate: 61 });
    const ops = await a.listOps();
    expect(ops.map(o => o.kind)).toEqual(['insert', 'update']);
    expect(ops[0].row.rate).toBe(60); // the possibly-sent insert was not altered
    clock += 10 * 60 * 1000;
    await engineFor(a).sync();
    expect(server.rows('jobs')[0]).toMatchObject({ rate: 61, version: 2 });
  });

  it('failed sync keeps pending work with a visible error and backs off', async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'J', rate: 1 });
    server.fault('server');
    await engineFor(a).sync();
    const [op] = await a.listOps();
    expect(op.status).toBe('pending');
    expect(op.lastError.kind).toBe('transient');
    expect(op.nextAttemptAt).toBeGreaterThan(clock);
    // not retried before the backoff expires
    const remote = server.remoteFor(A);
    await engineFor(a, remote).sync();
    expect(remote.calls).toEqual([]);
    expect((await a.loadAll()).data.jobs[0]._sync).toBe('syncing');
  });

  it('rejected change stays as an error until retried or discarded', async () => {
    const a = storeFor(A);
    const j = await a.create('jobs', { name: 'J', rate: 1 });
    server.fault('reject');
    await engineFor(a).sync();
    let [op] = await a.listOps();
    expect(op.status).toBe('error');
    expect((await a.loadAll()).data.jobs[0]._sync).toBe('error');
    await a.discard(op.opId);
    expect((await a.listOps()).length).toBe(0);
    expect((await a.loadAll()).data.jobs.find(x => x.id === j.id)).toBeUndefined();
  });

  it('backoff is bounded', () => {
    expect(backoffDelay(1, () => 1)).toBe(2000);
    expect(backoffDelay(50, () => 1)).toBe(5 * 60 * 1000);
  });

  it('a failing pull keeps the last good local copy', async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'J', rate: 1 });
    await engineFor(a).sync();
    server.fault('network'); // first fetchAll in the next run fails
    await engineFor(a).sync();
    expect((await a.loadAll()).data.jobs.length).toBe(1);
  });

  it('storage failure is reported, not treated as saved', async () => {
    const a = storeFor(A);
    const realTx = db.transaction.bind(db);
    db.transaction = (...args) => {
      const t = realTx(...args);
      const realStore = t.objectStore.bind(t);
      t.objectStore = n => {
        const s = realStore(n);
        if (n === 'outbox') s.put = () => { throw new DOMException('full', 'QuotaExceededError'); };
        return s;
      };
      return t;
    };
    await expect(a.create('jobs', { name: 'J', rate: 1 })).rejects.toMatchObject({ name: 'StorageError', quota: true });
    db.transaction = realTx;
    // nothing half-written: neither the record nor the op exists
    const view = await a.loadAll();
    expect(view.data.jobs).toEqual([]);
    expect(view.ops).toEqual([]);
  });
});

describe('conflicts', () => {
  it('detects an edit from another device and never silently overwrites it', async () => {
    const a = storeFor(A);
    const s = await a.create('sessions', { start_time: '2026-11-02T16:00:00Z', end_time: '2026-11-02T20:00:00Z', bill_rate: 65 });
    await engineFor(a).sync();
    server.editElsewhere('sessions', s.id, { bill_rate: 70 });
    await a.update('sessions', s.id, { bill_rate: 60 });
    await engineFor(a).sync();
    const [op] = await a.listOps();
    expect(op.status).toBe('conflict');
    expect(op.server.bill_rate).toBe(70);
    expect(server.rows('sessions')[0].bill_rate).toBe(70);
    expect((await a.loadAll()).data.sessions[0]._sync).toBe('conflict');

    // user keeps the other device's value
    await a.resolve(op.opId, 'theirs');
    expect((await a.loadAll()).data.sessions[0].bill_rate).toBe(70);
    expect((await a.listOps()).length).toBe(0);
  });

  it('"keep mine" re-applies on top of the newer server version', async () => {
    const a = storeFor(A);
    const j = await a.create('jobs', { name: 'J', rate: 60 });
    await engineFor(a).sync();
    server.editElsewhere('jobs', j.id, { name: 'Renamed elsewhere' });
    await a.update('jobs', j.id, { rate: 62 });
    await engineFor(a).sync();
    const [op] = await a.listOps();
    await a.resolve(op.opId, 'mine');
    await engineFor(a).sync();
    expect(server.rows('jobs')[0]).toMatchObject({ rate: 62, name: 'Renamed elsewhere', version: 3 });
  });

  it('delete of a record changed elsewhere becomes a conflict', async () => {
    const a = storeFor(A);
    const e = await a.create('expenses', { date: '2026-11-01', amount: 10 });
    await engineFor(a).sync();
    server.editElsewhere('expenses', e.id, { amount: 99 });
    await a.remove('expenses', e.id);
    await engineFor(a).sync();
    expect(server.rows('expenses').length).toBe(1);
    expect((await a.listOps())[0].status).toBe('conflict');
  });

  it('a record deleted on the server disappears locally once confirmed absent', async () => {
    const a = storeFor(A);
    const e = await a.create('expenses', { date: '2026-11-01', amount: 10 });
    await engineFor(a).sync();
    server.t('expenses').delete(e.id);
    clock += 1000;
    await engineFor(a).sync();
    expect((await a.loadAll()).data.expenses).toEqual([]);
  });
});

describe('sign-out and account switch during sync', () => {
  it('stop() during an in-flight request records nothing and keeps the op', async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'J', rate: 1 });
    let release;
    const gate = new Promise(r => { release = r; });
    const base = server.remoteFor(A);
    const slow = { ...base, insert: async (...args) => { await gate; return base.insert(...args); } };
    const statuses = [];
    const engine = createSyncEngine({ store: a, remote: slow, lock: noLock, now, onStatus: s => statuses.push(s.state) });
    const p = engine.sync();
    await new Promise(r => setTimeout(r, 10));
    engine.stop();                // user signs out / switches account
    const seen = statuses.length;
    release();
    await p;
    expect(statuses.length).toBe(seen); // late response produced no UI update
    const [op] = await a.listOps();
    expect(op).toBeDefined();           // op kept; it will be confirmed idempotently next time
    expect(op.uid).toBe(A);
  });

  it('a stopped engine does not start again', async () => {
    const a = storeFor(A);
    await a.create('jobs', { name: 'J', rate: 1 });
    const remote = server.remoteFor(A);
    const engine = engineFor(a, remote);
    engine.stop();
    await engine.sync();
    expect(remote.calls).toEqual([]);
  });
});
