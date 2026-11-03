import { describe, it, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../src/lib/localdb.js';
import { createLedgerStore } from '../src/lib/ledgerStore.js';
import { backupLegacyStorage, legacyAuthIdentity, adoptLegacyQueue, latestBackup } from '../src/lib/legacy.js';
import { createSyncEngine } from '../src/lib/sync.js';
import { createFakeServer } from './fakeRemote.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), keys: () => [...m.keys()] };
}
function fakeJwt(claims) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

let db;
beforeEach(async () => { db = await openLocalDb({ name: `legacy-${crypto.randomUUID()}` }); });

describe('legacy localStorage migration', () => {
  it('backs up, verifies, then removes legacy keys; keeps preferences', async () => {
    const storage = memStorage({
      sl_data_cache: JSON.stringify({ jobs: [{ id: 'j1', name: 'Old' }] }),
      sl_offline_queue: JSON.stringify([{ id: 'q1', type: 'insert', table: 'mileage', body: { job_id: 'j1', date: '2026-10-01', km: 5 } }]),
      sl_accent_color: '#123456',
      sl_auth_v4: JSON.stringify({ access_token: fakeJwt({ sub: A, email: 'a@example.test' }), refresh_token: 'r' }),
    });
    const rec = await backupLegacyStorage(db, storage);
    expect(rec.verified).toBe(true);
    expect(rec.ownerUid).toBe(A);
    expect(rec.status).toBe('needs-review');
    expect(storage.getItem('sl_data_cache')).toBeNull();
    expect(storage.getItem('sl_offline_queue')).toBeNull();
    expect(storage.getItem('sl_accent_color')).toBe('#123456');
    expect(storage.getItem('sl_auth_v4')).not.toBeNull(); // removed only after the session is migrated
    const saved = await latestBackup(db);
    expect(JSON.parse(saved.raw.sl_data_cache).jobs[0].name).toBe('Old');
  });

  it('records no owner when no login token was stored (unattributable)', async () => {
    const storage = memStorage({ sl_offline_queue: JSON.stringify([{ type: 'insert', table: 'jobs', body: { name: 'x', rate: 1 } }]) });
    const rec = await backupLegacyStorage(db, storage);
    expect(rec.ownerUid).toBeNull();
  });

  it('reads the owner from the legacy token', () => {
    const s = memStorage({ sl_auth_v4: JSON.stringify({ user: { id: A, email: 'a@example.test' }, access_token: 'x', refresh_token: 'y' }) });
    expect(legacyAuthIdentity(s)).toMatchObject({ uid: A, email: 'a@example.test' });
  });

  it('adopting old changes queues inserts, skips broken references, and never blindly overwrites', async () => {
    const server = createFakeServer();
    const store = createLedgerStore(db, A);
    const job = await store.create('jobs', { name: 'J', rate: 65 });
    const engine = () => createSyncEngine({ store, remote: server.remoteFor(A), lock: (_n, f) => f() });
    await engine().sync();
    server.editElsewhere('jobs', job.id, { rate: 70 });

    const results = await adoptLegacyQueue(store, [
      { type: 'insert', table: 'sessions', body: { job_id: job.id, start_time: '2026-10-01T15:00:00Z', end_time: '2026-10-01T23:00:00Z' } },
      { type: 'insert', table: 'sessions', body: { id: 'temp-1', job_id: 'temp-99', start_time: '2026-10-01T15:00:00Z' } },
      { type: 'update', table: 'jobs', recordId: job.id, body: { rate: 60 } },
    ]);
    expect(results.map(r => r.ok)).toEqual([true, false, true]);
    await engine().sync();
    expect(server.rows('sessions').length).toBe(1);
    expect(server.rows('jobs')[0].rate).toBe(70); // not overwritten
    const ops = await store.listOps();
    expect(ops.map(o => [o.table, o.status])).toEqual([['jobs', 'conflict']]);
  });
});
