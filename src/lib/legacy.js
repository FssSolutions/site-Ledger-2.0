// One-time migration of data left in localStorage by versions before
// 2026-11 (shared, account-less keys).
//
// Safety rules:
//  * The raw legacy values are copied into IndexedDB and read back before the
//    originals are removed from localStorage.
//  * Nothing is uploaded automatically. Old pending changes are offered for
//    review only to the account whose login token was stored alongside them;
//    if no token was stored, they stay in the on-device backup (see
//    docs/OFFLINE.md, "Recovering data from an older version").
//  * Old edits to existing records are re-queued without a known version, so
//    the sync engine compares them with the server and raises a conflict
//    instead of overwriting.

import { tx, reqP } from './localdb.js';
import { WRITABLE_FIELDS, pickWritable } from './schema.js';

export const LEGACY_DATA_KEYS = ['sl_data_cache', 'sl_offline_queue', 'sl_company', 'sl_break_state'];
export const LEGACY_AUTH_KEY = 'sl_auth_v4';

export function decodeJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(part.padEnd(part.length + (4 - part.length % 4) % 4, '=')) : Buffer.from(part, 'base64').toString();
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch { return null; }
}

export function legacyAuthIdentity(storage) {
  try {
    const raw = storage.getItem(LEGACY_AUTH_KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw);
    const claims = auth?.access_token ? decodeJwt(auth.access_token) : null;
    const uid = auth?.user?.id || claims?.sub || null;
    if (!uid) return null;
    return { uid, email: auth?.user?.email || claims?.email || null, access_token: auth.access_token, refresh_token: auth.refresh_token };
  } catch { return null; }
}

// Copies legacy keys into IndexedDB and, once verified, removes them from
// localStorage. Returns the backup record (or null if there was nothing).
export async function backupLegacyStorage(db, storage = globalThis.localStorage) {
  if (!storage) return null;
  const raw = {};
  for (const k of LEGACY_DATA_KEYS) {
    const v = storage.getItem(k);
    if (v != null) raw[k] = v;
  }
  if (Object.keys(raw).length === 0) return latestBackup(db);

  const ident = legacyAuthIdentity(storage);
  let queue = [];
  try { queue = JSON.parse(raw.sl_offline_queue || '[]') || []; } catch { queue = []; }
  let breakState = null;
  try { breakState = JSON.parse(raw.sl_break_state || 'null'); } catch { breakState = null; }

  const key = `v1-${Date.now()}`;
  const record = {
    key, savedAt: new Date().toISOString(), raw,
    ownerUid: ident?.uid || null, ownerEmail: ident?.email || null,
    queue: Array.isArray(queue) ? queue : [], breakState,
    status: Array.isArray(queue) && queue.length ? 'needs-review' : 'no-pending-changes',
  };
  await tx(db, 'legacy', 'readwrite', ({ legacy }) => { legacy.put(record); });

  // Verify the copy before deleting the originals.
  const check = await tx(db, 'legacy', 'readonly', ({ legacy }) => reqP(legacy.get(key)));
  const verified = check && LEGACY_DATA_KEYS.every(k => (raw[k] ?? null) === (check.raw[k] ?? null));
  if (verified) for (const k of Object.keys(raw)) storage.removeItem(k);
  return { ...record, verified };
}

export async function latestBackup(db) {
  const all = await tx(db, 'legacy', 'readonly', ({ legacy }) => reqP(legacy.getAll()));
  return all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))[0] || null;
}

export async function listBackups(db) {
  return tx(db, 'legacy', 'readonly', ({ legacy }) => reqP(legacy.getAll()));
}

export async function setBackupStatus(db, key, status, extra = {}) {
  await tx(db, 'legacy', 'readwrite', async ({ legacy }) => {
    const r = await reqP(legacy.get(key));
    if (r) legacy.put({ ...r, ...extra, status });
  });
}

const isTemp = v => typeof v === 'string' && v.startsWith('temp-');
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const COMPANY_FROM_DB = { name: 'name', phone: 'phone', email: 'email', address: 'address', gst_number: 'gst_number', worksafe_number: 'worksafe_number', logo: 'logo', half_day_rate: 'half_day_rate', full_day_rate: 'full_day_rate' };

// Human-readable summary of an old queued change, for the review panel.
export function describeLegacyOp(op) {
  const b = op.body || {};
  const what = { sessions: 'Time entry', jobs: 'Job', employees: 'Crew member', mileage: 'Trip', customers: 'Customer', expenses: 'Expense', invoices: 'Invoice' }[op.table] || 'Company profile';
  const verb = { insert: 'New', update: 'Edit to', delete: 'Delete', upsert_company: 'Edit to' }[op.type] || op.type;
  const detail = b.name || b.description || (b.start_time ? new Date(b.start_time).toLocaleString('en-CA') : '') || b.date || '';
  return `${verb} ${what.toLowerCase()}${detail ? ` — ${detail}` : ''}`;
}

// Re-queues reviewed legacy changes under `store`'s account. Only called after
// the user confirmed the changes are theirs. Returns per-op results.
export async function adoptLegacyQueue(store, queue, { companyId } = {}) {
  const results = [];
  for (const op of queue) {
    try {
      if (op.type === 'insert') {
        if (!WRITABLE_FIELDS[op.table]) { results.push({ op, ok: false, reason: 'Not supported offline in this version.' }); continue; }
        const body = { ...op.body };
        const tempRef = Object.entries(body).find(([k, v]) => k !== 'id' && isTemp(v));
        if (tempRef) { results.push({ op, ok: false, reason: 'Refers to a record that was never saved to the server.' }); continue; }
        const id = isUuid(body.id) ? body.id : undefined;
        await store.create(op.table, { ...pickWritable(op.table, body), ...(id ? { id } : {}) });
        results.push({ op, ok: true });
      } else if ((op.type === 'update' || op.type === 'delete') && op.table in WRITABLE_FIELDS) {
        if (isTemp(op.recordId)) { results.push({ op, ok: false, reason: 'Refers to a record that was never saved to the server.' }); continue; }
        await store.queueUnversioned(op.table, op.recordId, op.type, op.type === 'update' ? pickWritable(op.table, op.body || {}) : null);
        results.push({ op, ok: true });
      } else if (op.type === 'upsert_company') {
        const fields = {};
        for (const [k, v] of Object.entries(op.body || {})) if (COMPANY_FROM_DB[k]) fields[k] = v;
        if (companyId) await store.queueUnversioned('company_profiles', companyId, 'update', fields);
        else await store.create('company_profiles', fields);
        results.push({ op, ok: true });
      } else {
        results.push({ op, ok: false, reason: 'Invoices must be recorded online in this version.' });
      }
    } catch (e) {
      results.push({ op, ok: false, reason: e?.message || 'Could not be added.' });
    }
  }
  return results;
}
