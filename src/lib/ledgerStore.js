// Account-scoped local store: records plus the outbox of changes waiting to
// reach the server. Every user edit writes the record and its outbox entry in
// ONE IndexedDB transaction, so they can never disagree.
//
// Outbox rules
//  * An op that has never been sent (attempts === 0) may absorb later edits to
//    the same record (so offline clock-in + break + clock-out = one insert).
//  * An op that may have reached the server (attempts > 0) is never changed;
//    later edits become new ops.
//  * Ops for a record run in order. When one succeeds, later ops for that
//    record are re-based onto the server's new version.
//  * Ops are removed only after the server confirms them.

import { tx, reqP, getAllByIndex } from './localdb.js';
import { pickWritable, REFERENCES, ALL_TABLES } from './schema.js';

export function newId() {
  return globalThis.crypto.randomUUID();
}

const range = (uid, table) => IDBKeyRange.only([uid, table]);
const opsRange = uid => IDBKeyRange.bound([uid, -Infinity], [uid, Infinity]);
const recordOpsRange = (uid, table, id) => IDBKeyRange.only([uid, table, id]);

export function createLedgerStore(db, uid, { now = () => Date.now(), onChange = () => {} } = {}) {
  if (!uid) throw new Error('A ledger store needs an account id');

  async function nextSeq(meta) {
    const cur = await reqP(meta.get([uid, 'seq']));
    const seq = (cur?.value || 0) + 1;
    meta.put({ uid, key: 'seq', value: seq });
    return seq;
  }

  async function recordOps(outbox, table, id) {
    const ops = await getAllByIndex(outbox, 'byRecord', recordOpsRange(uid, table, id));
    return ops.sort((a, b) => a.seq - b.seq);
  }

  function changed(detail) { try { onChange(detail); } catch { /* listener errors never break storage */ } }

  return {
    uid,

    // ---- reads -------------------------------------------------------------
    async loadAll() {
      return tx(db, ['records', 'outbox'], 'readonly', async ({ records, outbox }) => {
        const ops = await getAllByIndex(outbox, 'byUidSeq', opsRange(uid));
        const state = {};
        for (const op of ops) {
          const k = `${op.table}:${op.recordId}`;
          const s = op.status === 'pending' ? (op.attempts > 0 ? 'syncing' : 'pending') : op.status;
          // worst state wins: conflict > error > syncing > pending
          const rank = { pending: 1, syncing: 2, error: 3, conflict: 4 };
          if (!state[k] || rank[s] > rank[state[k]]) state[k] = s;
        }
        const out = {};
        for (const table of ALL_TABLES) {
          const rows = await getAllByIndex(records, 'byUidTable', range(uid, table));
          out[table] = rows
            .filter(r => !r.deleted)
            .map(r => ({ ...r.data, _sync: state[`${table}:${r.id}`] || (r.base ? 'synced' : 'local') }));
        }
        return { data: out, ops };
      });
    },

    async getRecord(table, id) {
      return tx(db, 'records', 'readonly', ({ records }) => reqP(records.get([uid, table, id])));
    },

    async listOps() {
      return tx(db, 'outbox', 'readonly', async ({ outbox }) =>
        (await getAllByIndex(outbox, 'byUidSeq', opsRange(uid))));
    },

    async getMeta(key) {
      return tx(db, 'meta', 'readonly', async ({ meta }) => (await reqP(meta.get([uid, key])))?.value);
    },

    async setMeta(key, value) {
      await tx(db, 'meta', 'readwrite', ({ meta }) => { meta.put({ uid, key, value }); });
    },

    // ---- user edits ---------------------------------------------------------
    async create(table, values) {
      const id = values.id || newId();
      const row = { ...pickWritable(table, values), id, user_id: uid };
      await tx(db, ['records', 'outbox', 'meta'], 'readwrite', async ({ records, outbox, meta }) => {
        const existing = await reqP(records.get([uid, table, id]));
        if (existing) throw new Error(`Record ${id} already exists`);
        records.put({ uid, table, id, data: row, base: null, syncedAt: null, deleted: false });
        outbox.put({
          opId: newId(), uid, seq: await nextSeq(meta), table, recordId: id, kind: 'insert',
          row, attempts: 0, status: 'pending', createdAt: now(), nextAttemptAt: 0,
        });
      });
      changed({ table, id });
      return row;
    },

    async update(table, id, patch) {
      const fields = pickWritable(table, patch);
      let result;
      await tx(db, ['records', 'outbox', 'meta'], 'readwrite', async ({ records, outbox, meta }) => {
        const rec = await reqP(records.get([uid, table, id]));
        if (!rec || rec.deleted) throw new Error('That record no longer exists on this device.');
        rec.data = { ...rec.data, ...fields };
        records.put(rec);
        result = rec.data;
        const ops = await recordOps(outbox, table, id);
        const last = ops[ops.length - 1];
        if (last && last.attempts === 0 && last.status === 'pending' && last.kind === 'insert') {
          last.row = { ...last.row, ...fields };
          outbox.put(last);
        } else if (last && last.attempts === 0 && last.status === 'pending' && last.kind === 'update') {
          last.fields = { ...last.fields, ...fields };
          outbox.put(last);
        } else {
          outbox.put({
            opId: newId(), uid, seq: await nextSeq(meta), table, recordId: id, kind: 'update',
            fields, baseVersion: rec.base?.version ?? null, attempts: 0, status: 'pending',
            createdAt: now(), nextAttemptAt: 0,
          });
        }
      });
      changed({ table, id });
      return result;
    },

    async remove(table, id) {
      await tx(db, ['records', 'outbox', 'meta'], 'readwrite', async ({ records, outbox, meta }) => {
        const rec = await reqP(records.get([uid, table, id]));
        if (!rec) return;
        const ops = await recordOps(outbox, table, id);
        const neverSent = ops.length > 0 && ops[0].kind === 'insert' && ops.every(o => o.attempts === 0);
        if (neverSent) {
          // Never reached the server: forget it entirely.
          for (const o of ops) outbox.delete(o.opId);
          records.delete([uid, table, id]);
          return;
        }
        // Unsent edits are superseded by the delete.
        for (const o of ops) if (o.attempts === 0 && o.kind === 'update' && o.status === 'pending') outbox.delete(o.opId);
        if (ops.some(o => o.kind === 'delete')) return;
        rec.deleted = true;
        records.put(rec);
        outbox.put({
          opId: newId(), uid, seq: await nextSeq(meta), table, recordId: id, kind: 'delete',
          baseVersion: rec.base?.version ?? null, attempts: 0, status: 'pending',
          createdAt: now(), nextAttemptAt: 0,
        });
      });
      changed({ table, id });
    },

    // Queues a change whose base version is unknown (recovered from an older
    // app version). The sync engine compares it with the server copy and asks
    // the user if they differ, so it can never overwrite silently.
    async queueUnversioned(table, id, kind, fields) {
      await tx(db, ['records', 'outbox', 'meta'], 'readwrite', async ({ records, outbox, meta }) => {
        const rec = await reqP(records.get([uid, table, id]));
        if (rec && kind === 'update') { rec.data = { ...rec.data, ...fields }; records.put(rec); }
        if (rec && kind === 'delete') { rec.deleted = true; records.put(rec); }
        outbox.put({
          opId: newId(), uid, seq: await nextSeq(meta), table, recordId: id, kind,
          ...(kind === 'update' ? { fields } : {}), baseVersion: null, recovered: true,
          attempts: 1, status: 'pending', createdAt: now(), nextAttemptAt: 0,
        });
      });
      changed({ table, id });
    },

    // ---- sync engine primitives --------------------------------------------

    // Next op that may run now: pending, due, not blocked by an unresolved
    // earlier op on the same record or on a record it references.
    async nextRunnableOp() {
      const ops = await this.listOps();
      const unresolved = new Set();   // `${table}:${id}` with an earlier op still outstanding
      const t = now();
      for (const op of ops) {
        const key = `${op.table}:${op.recordId}`;
        const refs = op.kind === 'delete' ? [] : Object.entries(REFERENCES[op.table] || {})
          .map(([col, parent]) => {
            const v = (op.row || op.fields || {})[col];
            return v ? `${parent}:${v}` : null;
          }).filter(Boolean);
        const blocked = unresolved.has(key) || refs.some(r => unresolved.has(r));
        if (!blocked && op.status === 'pending' && (op.nextAttemptAt || 0) <= t) return op;
        unresolved.add(key);
      }
      return null;
    },

    // Recorded BEFORE the request is sent, so a lost response is still known
    // to have possibly reached the server.
    async markAttempt(opId) {
      await tx(db, 'outbox', 'readwrite', async ({ outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        op.attempts += 1;
        op.lastAttemptAt = now();
        outbox.put(op);
      });
    },

    async complete(opId, serverRow) {
      await tx(db, ['records', 'outbox'], 'readwrite', async ({ records, outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        outbox.delete(opId);
        const rest = (await recordOps(outbox, op.table, op.recordId)).filter(o => o.opId !== opId);
        if (op.kind === 'delete') {
          for (const o of rest) outbox.delete(o.opId);
          records.delete([uid, op.table, op.recordId]);
          return;
        }
        for (const o of rest) { o.baseVersion = serverRow.version; outbox.put(o); }
        const rec = await reqP(records.get([uid, op.table, op.recordId]));
        const pendingLocal = rest.length > 0;
        records.put({
          uid, table: op.table, id: op.recordId,
          data: pendingLocal && rec ? { ...rec.data, version: serverRow.version } : serverRow,
          base: serverRow, syncedAt: now(), deleted: rec?.deleted || false,
        });
      });
      changed({ table: null, id: null });
    },

    async retryLater(opId, error, delayMs) {
      await tx(db, 'outbox', 'readwrite', async ({ outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        op.lastError = error;
        op.nextAttemptAt = now() + delayMs;
        outbox.put(op);
      });
      changed({});
    },

    async fail(opId, error) {
      await tx(db, 'outbox', 'readwrite', async ({ outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        op.status = 'error';
        op.lastError = error;
        outbox.put(op);
      });
      changed({});
    },

    async conflict(opId, serverRow, error) {
      await tx(db, 'outbox', 'readwrite', async ({ outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        op.status = 'conflict';
        op.server = serverRow || null;
        op.lastError = error;
        outbox.put(op);
      });
      changed({});
    },

    // User chose to try a failed op again.
    async retry(opId) {
      await tx(db, 'outbox', 'readwrite', async ({ outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op || op.status === 'pending') return;
        op.status = 'pending';
        op.nextAttemptAt = 0;
        outbox.put(op);
      });
      changed({});
    },

    // Conflict resolution. 'mine' re-applies the local change on top of the
    // server's current version; 'theirs' discards local changes to the record.
    async resolve(opId, choice) {
      await tx(db, ['records', 'outbox'], 'readwrite', async ({ records, outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        const rec = await reqP(records.get([uid, op.table, op.recordId]));
        if (choice === 'mine') {
          if (!op.server && op.kind !== 'delete') {
            // Deleted on the server: re-create it from the local copy.
            outbox.delete(op.opId);
            outbox.put({
              opId: newId(), uid, seq: op.seq, table: op.table, recordId: op.recordId, kind: 'insert',
              row: { ...pickWritable(op.table, rec?.data || {}), id: op.recordId, user_id: uid },
              attempts: 0, status: 'pending', createdAt: now(), nextAttemptAt: 0,
            });
          } else {
            op.baseVersion = op.server?.version ?? null;
            op.status = 'pending';
            op.nextAttemptAt = 0;
            op.forced = true;
            delete op.server;
            outbox.put(op);
          }
          return;
        }
        // theirs
        const ops = await recordOps(outbox, op.table, op.recordId);
        for (const o of ops) if (o.seq >= op.seq) outbox.delete(o.opId);
        if (op.server) {
          records.put({ uid, table: op.table, id: op.recordId, data: op.server, base: op.server, syncedAt: now(), deleted: false });
        } else {
          records.delete([uid, op.table, op.recordId]);
        }
      });
      changed({});
    },

    // Discard a failed change after explicit user confirmation. Reverts the
    // record to the last server copy (or removes a never-synced record).
    async discard(opId) {
      await tx(db, ['records', 'outbox'], 'readwrite', async ({ records, outbox }) => {
        const op = await reqP(outbox.get(opId));
        if (!op) return;
        const ops = await recordOps(outbox, op.table, op.recordId);
        for (const o of ops) if (o.seq >= op.seq) outbox.delete(o.opId);
        const rec = await reqP(records.get([uid, op.table, op.recordId]));
        if (!rec) return;
        const remaining = ops.filter(o => o.seq < op.seq);
        if (rec.base && remaining.length === 0) {
          records.put({ ...rec, data: rec.base, deleted: false });
        } else if (!rec.base && remaining.length === 0) {
          records.delete([uid, op.table, op.recordId]);
        }
      });
      changed({});
    },

    // Merge a complete server snapshot of one table into local storage.
    // Records with outstanding local changes keep their local values. Records
    // missing from the snapshot are removed only if they were confirmed
    // before the snapshot started and have no local changes.
    async applyPull(table, rows, pullStartedAt) {
      await tx(db, ['records', 'outbox'], 'readwrite', async ({ records, outbox }) => {
        const ops = await getAllByIndex(outbox, 'byUidSeq', opsRange(uid));
        const withOps = new Set(ops.filter(o => o.table === table).map(o => o.recordId));
        const local = await getAllByIndex(records, 'byUidTable', range(uid, table));
        const localById = new Map(local.map(r => [r.id, r]));
        const seen = new Set();
        for (const row of rows) {
          if (row.user_id && row.user_id !== uid) continue; // never store another account's row
          seen.add(row.id);
          if (withOps.has(row.id)) continue;
          const cur = localById.get(row.id);
          if (cur?.base && Number(cur.base.version) > Number(row.version)) continue; // stale snapshot
          records.put({ uid, table, id: row.id, data: row, base: row, syncedAt: now(), deleted: false });
        }
        for (const rec of local) {
          if (seen.has(rec.id) || withOps.has(rec.id)) continue;
          if (rec.base && rec.syncedAt != null && rec.syncedAt < pullStartedAt) records.delete([uid, table, rec.id]);
        }
      });
      changed({ table });
    },

    // Counts used by sign-out and the account banner.
    async pendingCount() {
      return (await this.listOps()).length;
    },

    // Removes this account's cached records. Refuses while changes are
    // outstanding, so unsynced work is never silently deleted.
    async clearCache() {
      return tx(db, ['records', 'outbox', 'meta'], 'readwrite', async ({ records, outbox, meta }) => {
        const ops = await getAllByIndex(outbox, 'byUidSeq', opsRange(uid));
        if (ops.length) return false;
        for (const table of ALL_TABLES) {
          const keys = await reqP(records.index('byUidTable').getAllKeys(range(uid, table)));
          for (const k of keys) records.delete(k);
        }
        const metaKeys = await reqP(meta.getAllKeys(IDBKeyRange.bound([uid, ''], [uid, '￿'])));
        for (const k of metaKeys) meta.delete(k);
        return true;
      });
    },
  };
}

// Accounts with outstanding changes on this device (for the sign-in screen).
export async function accountsWithPendingWork(db) {
  return tx(db, ['outbox', 'meta'], 'readonly', async ({ outbox, meta }) => {
    const ops = await reqP(outbox.getAll());
    const counts = {};
    for (const op of ops) counts[op.uid] = (counts[op.uid] || 0) + 1;
    const out = [];
    for (const uid of Object.keys(counts)) {
      const acct = await reqP(meta.get([uid, 'account']));
      out.push({ uid, email: acct?.value?.email || null, pending: counts[uid] });
    }
    return out;
  });
}
