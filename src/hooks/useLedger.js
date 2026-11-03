import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openLocalDb } from '../lib/localdb.js';
import { createLedgerStore, accountsWithPendingWork } from '../lib/ledgerStore.js';
import { createSyncEngine } from '../lib/sync.js';
import { createRemote } from '../lib/remote.js';
import { createAccountClient } from '../lib/supabaseClient.js';
import { createActions, deriveView } from '../lib/ledgerActions.js';
import { backupLegacyStorage, latestBackup } from '../lib/legacy.js';

let dbPromise = null;
export function getLocalDb() {
  if (!dbPromise) {
    dbPromise = openLocalDb({
      onVersionChange: () => {
        // A newer version of the app opened in another tab and is upgrading
        // offline storage; reload so this tab uses the new code too.
        dbPromise = null;
        window.location.reload();
      },
    }).catch(e => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

const EMPTY = deriveView({});
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('siteledger-data') : null;

// Account-scoped ledger. Everything here belongs to `user.uid`; when the
// account changes the previous store/engine are stopped and their state is
// discarded, and late results from them are ignored.
export function useLedger(user, { online = true } = {}) {
  const uid = user?.uid || null;
  const [state, setState] = useState({ uid: null, ready: false, raw: {}, ops: [], sync: { state: 'idle' }, storageError: null, legacy: null });
  const ctx = useRef(null);       // { uid, store, engine, remote }
  const viewRef = useRef(EMPTY);

  const view = useMemo(() => (state.uid === uid ? deriveView(state.raw) : EMPTY), [state.raw, state.uid, uid]);
  viewRef.current = view;

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    let reloadQueued = false;
    let syncTimer = null;
    const isCurrent = () => alive && ctx.current?.uid === uid;

    setState({ uid, ready: false, raw: {}, ops: [], sync: { state: 'idle' }, storageError: null, legacy: null });

    async function reload() {
      if (!isCurrent()) return;
      const { store } = ctx.current;
      try {
        const v = await store.loadAll();
        if (!isCurrent()) return;  // account changed while reading
        setState(s => (s.uid === uid ? { ...s, ready: true, raw: v.data, ops: v.ops } : s));
      } catch (e) {
        if (isCurrent()) setState(s => ({ ...s, storageError: e.message }));
      }
    }
    function queueReload() {
      if (reloadQueued) return;
      reloadQueued = true;
      queueMicrotask(() => { reloadQueued = false; reload(); });
    }
    function scheduleSync(delay = 400) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { if (isCurrent()) ctx.current.engine.sync(); }, delay);
    }

    (async () => {
      try {
        const db = await getLocalDb();
        const legacyRecord = await backupLegacyStorage(db).catch(() => null);
        if (!alive) return;
        const store = createLedgerStore(db, uid, {
          onChange: () => { queueReload(); channel?.postMessage({ uid }); scheduleSync(); },
        });
        await store.setMeta('account', { email: user.email || null });
        const remote = createRemote(createAccountClient(uid));
        const engine = createSyncEngine({
          store, remote,
          onStatus: s => { if (isCurrent()) { setState(p => ({ ...p, sync: s })); queueReload(); } },
        });
        if (!alive) { engine.stop(); return; }
        ctx.current = { uid, store, engine, remote, db };
        const legacy = legacyRecord || (await latestBackup(db));
        if (isCurrent()) setState(s => ({ ...s, legacy }));
        await reload();
        engine.sync();
      } catch (e) {
        if (alive) setState(s => ({ ...s, ready: true, storageError: e.message || 'Offline storage is unavailable.' }));
      }
    })();

    const onMessage = ev => { if (ev.data?.uid === uid) queueReload(); };
    channel?.addEventListener('message', onMessage);
    const kick = () => { if (isCurrent()) ctx.current.engine.sync(); };
    const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVisible);
    // Regular attempts while there is pending work (backoff is enforced per
    // change by the engine), and a periodic refresh while visible.
    const tick = setInterval(async () => {
      if (!isCurrent()) return;
      const pending = await ctx.current.store.pendingCount().catch(() => 0);
      if (pending > 0 || document.visibilityState === 'visible') kick();
    }, 30000);

    return () => {
      alive = false;
      ctx.current?.engine.stop();
      ctx.current = null;
      clearTimeout(syncTimer);
      clearInterval(tick);
      channel?.removeEventListener('message', onMessage);
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
      setState({ uid: null, ready: false, raw: {}, ops: [], sync: { state: 'idle' }, storageError: null, legacy: null });
    };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bound to the current account; returns a failure if the account changed.
  const actions = useMemo(() => {
    const local = () => {
      const c = ctx.current;
      if (!c || c.uid !== uid) return null;
      return createActions({ store: c.store, getView: () => viewRef.current });
    };
    const names = ['clockIn', 'startBreak', 'endBreak', 'clockOut', 'saveSession', 'deleteSession', 'addJob', 'updateJob', 'deleteJob',
      'addEmployee', 'updateEmployee', 'deleteEmployee', 'addCustomer', 'updateCustomer', 'deleteCustomer',
      'addMileage', 'deleteMileage', 'addExpense', 'deleteExpense', 'saveCompany'];
    const out = {};
    for (const n of names) {
      out[n] = async (...args) => {
        const a = local();
        if (!a) return { ok: false, error: 'Still loading. Try again in a moment.' };
        return a[n](...args);
      };
    }
    return out;
  }, [uid, state.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const withCtx = useCallback(fn => {
    const c = ctx.current;
    if (!c || c.uid !== uid) return Promise.resolve({ ok: false, error: 'Still loading. Try again in a moment.' });
    return fn(c);
  }, [uid]);

  // ---- server-authoritative operations (need a connection) ----------------

  const recordInvoice = useCallback((invoice, sessionIds, lines) => withCtx(async c => {
    const r = await c.remote.rpc('record_invoice', { p_invoice: invoice, p_session_ids: sessionIds, p_lines: lines });
    if (ctx.current !== c) return { ok: false, error: 'Account changed.' };
    if (!r.ok) {
      const offline = r.error.kind === 'network';
      return { ok: false, error: offline ? 'No connection. Nothing was recorded; try again when you have service.' : r.error.message, offline, retryable: offline || r.error.kind === 'transient' };
    }
    const { invoice: inv, lines: savedLines } = r.data || {};
    await c.store.putServerRows('invoices', [inv]);
    await c.store.putServerRows('invoice_lines', savedLines || []);
    // Refresh sessions so they show as billed.
    const sessions = await c.remote.fetchAll('sessions');
    if (sessions.ok) await c.store.applyPull('sessions', sessions.data, Date.now() - 1);
    return { ok: true, data: { invoice: inv, lines: savedLines || [], replayed: r.data?.replayed } };
  }), [withCtx]);

  const setInvoiceStatus = useCallback((id, status) => withCtx(async c => {
    const r = await c.remote.updateRow('invoices', id, { status });
    if (!r.ok) return { ok: false, error: r.error.kind === 'network' ? 'No connection. Invoice status needs internet.' : r.error.message };
    await c.store.putServerRows('invoices', [r.data]);
    return { ok: true, data: r.data };
  }), [withCtx]);

  const deleteInvoice = useCallback(id => withCtx(async c => {
    const r = await c.remote.deleteRow('invoices', id);
    if (!r.ok) return { ok: false, error: r.error.kind === 'network' ? 'No connection. Deleting an invoice needs internet.' : r.error.message };
    if (r.data !== 1) return { ok: false, error: 'The invoice was not found on the server.' };
    await c.store.removeServerRow('invoices', id);
    await c.engine.sync();
    return { ok: true };
  }), [withCtx]);

  // ---- outbox management --------------------------------------------------
  const retryOp = useCallback(opId => withCtx(async c => { await c.store.retry(opId); c.engine.sync(); return { ok: true }; }), [withCtx]);
  const discardOp = useCallback(opId => withCtx(async c => { await c.store.discard(opId); return { ok: true }; }), [withCtx]);
  const resolveConflict = useCallback((opId, choice) => withCtx(async c => { await c.store.resolve(opId, choice); c.engine.sync(); return { ok: true }; }), [withCtx]);
  const syncNow = useCallback(() => withCtx(async c => { await c.engine.sync(); return { ok: true }; }), [withCtx]);

  // Sign-out: stop syncing, then remove this account's cached records if
  // nothing is pending. Pending work is kept on the device under this account.
  const prepareSignOut = useCallback(() => withCtx(async c => {
    c.engine.stop();
    const pending = await c.store.pendingCount();
    let cleared = false;
    if (pending === 0) cleared = await c.store.clearCache();
    return { ok: true, data: { pending, cleared } };
  }), [withCtx]);

  const pendingCount = state.ops.length;
  const problemOps = state.ops.filter(o => o.status !== 'pending');

  return {
    ready: state.ready && state.uid === uid,
    view,
    ops: state.ops,
    pendingCount,
    problemOps,
    sync: state.sync,
    storageError: state.storageError,
    legacy: state.legacy,
    online,
    actions,
    recordInvoice, setInvoiceStatus, deleteInvoice,
    retryOp, discardOp, resolveConflict, syncNow, prepareSignOut,
    getStore: () => (ctx.current?.uid === uid ? ctx.current.store : null),
  };
}

export async function otherAccountsPending(currentUid) {
  try {
    const db = await getLocalDb();
    return (await accountsWithPendingWork(db)).filter(a => a.uid !== currentUid);
  } catch { return []; }
}
