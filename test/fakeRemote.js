// In-memory stand-in for the Supabase REST API as seen through remote.js.
// Enforces per-account ownership and row versions like the real policies and
// triggers, and can inject failures.
export function createFakeServer() {
  const tables = {};
  const t = name => (tables[name] ||= new Map());
  let faults = [];

  function fault(kind) { faults.push(kind); }
  function takeFault() { return faults.shift(); }

  function remoteFor(uid) {
    const visible = (table) => [...t(table).values()].filter(r => r.user_id === uid);
    async function guard(commit) {
      const f = takeFault();
      if (f === 'network') return { ok: false, error: { kind: 'network', message: 'Failed to fetch', status: 0 } };
      if (f === 'server') return { ok: false, error: { kind: 'transient', message: 'Bad gateway', status: 502 } };
      if (f === 'reject') return { ok: false, error: { kind: 'rejected', message: 'violates check constraint', status: 400, code: '23514' } };
      const result = await commit();
      if (f === 'lose-response') return { ok: false, error: { kind: 'network', message: 'Failed to fetch', status: 0 } };
      return result;
    }
    return {
      calls: [],
      async schemaVersion() { return { ok: true, data: 2 }; },
      async insert(table, row) {
        this.calls.push(['insert', table, row.id]);
        return guard(() => {
          if (row.user_id !== uid) return { ok: false, error: { kind: 'rejected', message: 'new row violates row-level security policy', status: 403, code: '42501' } };
          const existing = t(table).get(row.id);
          if (existing) return existing.user_id === uid ? { ok: true, data: { ...existing }, created: false }
            : { ok: false, error: { kind: 'rejected', message: 'not stored', status: 403, code: 'NOT_STORED' } };
          for (const [col, parent] of Object.entries({ job_id: 'jobs', employee_id: 'employees' })) {
            if (row[col] && !(t(parent).get(row[col])?.user_id === uid)) {
              return { ok: false, error: { kind: 'rejected', message: `${col} does not belong to this account`, status: 403, code: '42501' } };
            }
          }
          const stored = { ...row, version: 1, invoice_id: null };
          t(table).set(row.id, stored);
          return { ok: true, data: { ...stored }, created: true };
        });
      },
      async getById(table, id) {
        const r = t(table).get(id);
        return { ok: true, data: r && r.user_id === uid ? { ...r } : null };
      },
      async update(table, id, version, fields) {
        this.calls.push(['update', table, id]);
        return guard(() => {
          const r = t(table).get(id);
          if (!r || r.user_id !== uid || (version != null && r.version !== version)) return { ok: true, data: null };
          const next = { ...r, ...fields, version: r.version + 1 };
          t(table).set(id, next);
          return { ok: true, data: { ...next } };
        });
      },
      async delete(table, id, version) {
        this.calls.push(['delete', table, id]);
        return guard(() => {
          const r = t(table).get(id);
          if (!r || r.user_id !== uid || (version != null && r.version !== version)) return { ok: true, data: false };
          t(table).delete(id);
          return { ok: true, data: true };
        });
      },
      async fetchAll(table) {
        const f = takeFault();
        if (f === 'network') return { ok: false, error: { kind: 'network', message: 'Failed to fetch', status: 0 } };
        return { ok: true, data: visible(table).map(r => ({ ...r })) };
      },
    };
  }

  // Simulates an edit made on another device.
  function editElsewhere(table, id, fields) {
    const r = t(table).get(id);
    t(table).set(id, { ...r, ...fields, version: r.version + 1 });
  }

  return { tables, t, fault, remoteFor, editElsewhere, rows: name => [...t(name).values()] };
}
