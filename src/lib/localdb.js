// Small promise wrapper around IndexedDB. One database holds every account's
// data; every key starts with the owning account id (uid), so reads are always
// partitioned by account.
//
// Account separation here is an access-control feature of the app, not
// encryption: anyone with access to this browser profile (or a malicious
// script on this origin) can read IndexedDB. See docs/SECURITY.md.

export const DB_NAME = 'siteledger';
export const DB_VERSION = 1;

// Each entry upgrades from the previous version. Never delete stores or data
// in an upgrade: pending offline work must survive app updates.
const UPGRADES = {
  1(db) {
    const records = db.createObjectStore('records', { keyPath: ['uid', 'table', 'id'] });
    records.createIndex('byUidTable', ['uid', 'table']);
    const outbox = db.createObjectStore('outbox', { keyPath: 'opId' });
    outbox.createIndex('byUidSeq', ['uid', 'seq']);
    outbox.createIndex('byRecord', ['uid', 'table', 'recordId']);
    db.createObjectStore('meta', { keyPath: ['uid', 'key'] });
    db.createObjectStore('legacy', { keyPath: 'key' });
  },
};

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
    this.quota = cause?.name === 'QuotaExceededError';
  }
}

export function openLocalDb({ indexedDB = globalThis.indexedDB, name = DB_NAME, onVersionChange } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new StorageError('This browser has no offline storage (IndexedDB).')); return; }
    let req;
    try { req = indexedDB.open(name, DB_VERSION); } catch (e) { reject(new StorageError('Could not open offline storage.', e)); return; }
    req.onupgradeneeded = ev => {
      const db = req.result;
      for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) UPGRADES[v](db, req.transaction);
    };
    req.onblocked = () => reject(new StorageError('Close other SiteLedger tabs to finish updating offline storage.'));
    req.onerror = () => reject(new StorageError('Could not open offline storage.', req.error));
    req.onsuccess = () => {
      const db = req.result;
      // A newer app version in another tab needs to upgrade: release the
      // connection instead of blocking it.
      db.onversionchange = () => { db.close(); onVersionChange?.(); };
      resolve(db);
    };
  });
}

export function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs fn inside one transaction. Resolves with fn's result only after the
// transaction has COMMITTED, so callers never report "saved" for a write that
// was rolled back (e.g. quota exceeded).
export function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(storeNames, mode); } catch (e) { reject(new StorageError('Offline storage is unavailable.', e)); return; }
    const stores = Object.fromEntries([].concat(storeNames).map(n => [n, t.objectStore(n)]));
    let result;
    let failed = null;
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
    t.onerror = () => { failed = failed || new StorageError(describe(t.error), t.error); };
    t.onabort = () => reject(failed || new StorageError(describe(t.error), t.error));
    Promise.resolve()
      .then(() => fn(stores, t))
      .then(r => { result = r; })
      .catch(e => {
        failed = e instanceof StorageError ? e : (e?.name === 'QuotaExceededError' ? new StorageError(describe(e), e) : e);
        try { t.abort(); } catch { /* already finished */ }
      });
  });
}

function describe(err) {
  if (err?.name === 'QuotaExceededError') return 'This device is out of storage space. The change was NOT saved.';
  return 'Could not save on this device. The change was NOT saved.';
}

export function getAllByIndex(store, indexName, range) {
  return reqP(store.index(indexName).getAll(range));
}
