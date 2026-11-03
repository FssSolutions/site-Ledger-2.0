// Pushes one account's outbox to the server, then pulls fresh snapshots.
//
// * One engine per account; it only ever talks to the server through a
//   client bound to that account's token (see auth.js), so an account's
//   changes are never uploaded under another account.
// * navigator.onLine is only a hint. Reachability is learned from requests.
// * Transient failures back off (bounded); rejected changes stay in the
//   outbox as errors until the user retries or discards them.
// * Concurrent tabs are serialised with a Web Lock where available.

import { SYNCED_TABLES, ALL_TABLES, TABLE_ORDER, fieldsMatch } from './schema.js';

export const REQUIRED_SCHEMA_VERSION = 2;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function backoffDelay(attempts, random = Math.random) {
  const base = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base / 2 + random() * base / 2);
}

function errText(error) {
  return { kind: error.kind, message: error.message, status: error.status ?? 0, code: error.code || '' };
}

export function createSyncEngine({ store, remote, lock = webLock, now = () => Date.now(), onStatus = () => {} }) {
  let running = null;
  let stopped = false;
  let controller = null;
  let schemaOk = false;
  let status = { state: 'idle', lastError: null, lastSyncedAt: null, serverOutdated: false, needsSignIn: false };

  function setStatus(patch) {
    status = { ...status, ...patch };
    if (!stopped) onStatus(status);
  }

  async function execute(op, signal) {
    if (op.kind === 'insert') {
      const r = await remote.insert(op.table, op.row, signal);
      if (!r.ok) return { outcome: 'error', error: r.error };
      return { outcome: 'ok', row: r.data };
    }

    if (op.kind === 'update') {
      if (op.baseVersion != null) {
        const r = await remote.update(op.table, op.recordId, op.baseVersion, op.fields, signal);
        if (!r.ok) return { outcome: 'error', error: r.error };
        if (r.data) return { outcome: 'ok', row: r.data };
      }
      // Version mismatch, or no known base version (e.g. recovered legacy
      // change): never overwrite blindly; decide from the server's copy.
      const fresh = await remote.getById(op.table, op.recordId, signal);
      if (!fresh.ok) return { outcome: 'error', error: fresh.error };
      if (!fresh.data) return { outcome: 'conflict', server: null, message: 'This record was deleted on another device.' };
      if (fieldsMatch(op.fields, fresh.data)) return { outcome: 'ok', row: fresh.data }; // already applied (lost response)
      return { outcome: 'conflict', server: fresh.data, message: 'This record was changed on another device.' };
    }

    if (op.kind === 'delete') {
      if (op.baseVersion != null) {
        const r = await remote.delete(op.table, op.recordId, op.baseVersion, signal);
        if (!r.ok) return { outcome: 'error', error: r.error };
        if (r.data) return { outcome: 'ok', row: null };
      }
      const fresh = await remote.getById(op.table, op.recordId, signal);
      if (!fresh.ok) return { outcome: 'error', error: fresh.error };
      if (!fresh.data) return { outcome: 'ok', row: null }; // already gone
      return { outcome: 'conflict', server: fresh.data, message: op.baseVersion == null ? 'Confirm this delete: the server copy may be newer than this device knew.' : 'This record was changed on another device before it was deleted.' };
    }
    return { outcome: 'error', error: { kind: 'rejected', message: `Unknown change type ${op.kind}` } };
  }

  async function push(signal) {
    for (;;) {
      if (stopped || signal.aborted) return 'stopped';
      const op = await store.nextRunnableOp();
      if (!op) return 'done';
      await store.markAttempt(op.opId);
      const res = await execute(op, signal);
      if (stopped || signal.aborted || res.error?.kind === 'aborted') return 'stopped';

      if (res.outcome === 'ok') {
        await store.complete(op.opId, res.row);
        continue;
      }
      if (res.outcome === 'conflict') {
        await store.conflict(op.opId, res.server, { kind: 'conflict', message: res.message });
        continue;
      }
      const e = res.error;
      if (e.kind === 'network' || e.kind === 'transient' || e.kind === 'auth') {
        await store.retryLater(op.opId, errText(e), backoffDelay(op.attempts + 1));
        if (e.kind === 'auth') setStatus({ needsSignIn: true });
        return e.kind;
      }
      await store.fail(op.opId, errText(e));
    }
  }

  async function pull(signal) {
    const order = [...TABLE_ORDER, ...ALL_TABLES.filter(t => !TABLE_ORDER.includes(t))];
    for (const table of order) {
      if (stopped || signal.aborted) return 'stopped';
      const startedAt = now();
      const r = await remote.fetchAll(table, signal);
      if (stopped || signal.aborted) return 'stopped';
      if (!r.ok) {
        // Keep the last good local copy; never replace it with an empty result.
        if (r.error.kind === 'aborted') return 'stopped';
        return r.error;
      }
      await store.applyPull(table, r.data, startedAt);
    }
    return 'done';
  }

  async function runOnce({ pullAfter = true } = {}) {
    controller = new AbortController();
    const { signal } = controller;
    setStatus({ state: 'syncing' });

    if (!schemaOk) {
      const v = await remote.schemaVersion(signal);
      if (stopped) return;
      if (!v.ok) {
        if (v.error.kind === 'rejected') {
          // Function missing: the server has not been migrated yet. Hold all
          // changes locally rather than sending columns it does not have.
          setStatus({ state: 'held', serverOutdated: true, lastError: errText(v.error) });
        } else {
          setStatus({ state: v.error.kind === 'auth' ? 'needs-sign-in' : 'offline', lastError: errText(v.error), needsSignIn: v.error.kind === 'auth' });
        }
        return;
      }
      if (Number(v.data) < REQUIRED_SCHEMA_VERSION) {
        setStatus({ state: 'held', serverOutdated: true });
        return;
      }
      schemaOk = true;
      setStatus({ serverOutdated: false, needsSignIn: false });
    }

    const pushed = await push(signal);
    if (pushed === 'stopped') return;
    if (pushed !== 'done') {
      setStatus({ state: pushed === 'auth' ? 'needs-sign-in' : 'offline' });
      return;
    }
    if (pullAfter) {
      const pulled = await pull(signal);
      if (pulled === 'stopped') return;
      if (pulled !== 'done') {
        setStatus({ state: pulled.kind === 'auth' ? 'needs-sign-in' : pulled.kind === 'rejected' ? 'error' : 'offline', lastError: errText(pulled) });
        return;
      }
    }
    setStatus({ state: 'idle', lastError: null, lastSyncedAt: now(), needsSignIn: false });
  }

  return {
    get status() { return status; },

    // Coalesces overlapping requests: callers share the in-flight run.
    sync(opts) {
      if (stopped) return Promise.resolve();
      if (running) return running;
      running = lock(`siteledger-sync-${store.uid}`, () => runOnce(opts))
        .catch(e => { setStatus({ state: 'error', lastError: { kind: 'local', message: e?.message || String(e) } }); })
        .finally(() => { running = null; });
      return running;
    },

    // Called on sign-out or account switch: cancel in-flight requests and
    // ignore any late responses.
    stop() {
      stopped = true;
      controller?.abort();
    },

    get stopped() { return stopped; },
  };
}

// Web Locks serialise sync across tabs. If another tab holds the lock, this
// tab skips the run (the other tab is already syncing the same outbox).
export async function webLock(name, fn) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fn();
  return locks.request(name, { ifAvailable: true }, async l => (l ? fn() : undefined));
}

export { SYNCED_TABLES };
