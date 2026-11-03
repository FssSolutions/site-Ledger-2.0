// Server access with explicit results. Every call returns either
//   { ok: true, data }   or   { ok: false, error: { kind, message, status, code } }
// so an empty successful query ([]) can never be confused with a failure.
//
// error.kind:
//   network   – no response (offline, DNS, timeout). Retry later.
//   auth      – token rejected/expired. Retry after the session refreshes.
//   transient – 408/429/5xx. Retry later.
//   aborted   – cancelled (sign-out or account switch). Do not record.
//   rejected  – the server refused the request (validation, RLS, constraint).
//               Retrying unchanged will not help.

export const PAGE_SIZE = 1000;

export function classifyError(error, status) {
  const code = error?.code || '';
  const message = error?.message || 'Request failed';
  if (error?.name === 'AbortError' || /AbortError|aborted/i.test(message) && !status) return { kind: 'aborted', message, status, code };
  if (!status) return { kind: 'network', message, status: 0, code };
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return { kind: 'auth', message, status, code };
  if (status === 408 || status === 429 || status >= 500) return { kind: 'transient', message, status, code };
  return { kind: 'rejected', message, status, code };
}

function wrap({ data, error, status }) {
  if (error) return { ok: false, error: classifyError(error, status) };
  return { ok: true, data };
}

async function call(fn) {
  try {
    return wrap(await fn());
  } catch (e) {
    // supabase-js accessToken() throws when the signed-in account changed.
    if (e?.code === 'ACCOUNT_CHANGED') return { ok: false, error: { kind: 'aborted', message: e.message, status: 0, code: e.code } };
    return { ok: false, error: classifyError(e, 0) };
  }
}

const withSignal = (q, signal) => (signal ? q.abortSignal(signal) : q);

// `client` is a supabase-js client bound to ONE account (see auth.js).
export function createRemote(client) {
  return {
    async schemaVersion(signal) {
      return call(() => withSignal(client.rpc('ledger_schema_version'), signal));
    },

    // Idempotent create: if a previous attempt already committed (response
    // lost), the duplicate is ignored and the existing row is returned.
    async insert(table, row, signal) {
      const r = await call(() => withSignal(
        client.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select(), signal));
      if (!r.ok) return r;
      if (Array.isArray(r.data) && r.data[0]) return { ok: true, data: r.data[0], created: true };
      const existing = await this.getById(table, row.id, signal);
      if (!existing.ok) return existing;
      if (!existing.data) {
        return { ok: false, error: { kind: 'rejected', message: 'The server did not accept this record.', status: 403, code: 'NOT_STORED' } };
      }
      return { ok: true, data: existing.data, created: false };
    },

    async getById(table, id, signal) {
      return call(() => withSignal(client.from(table).select('*').eq('id', id).maybeSingle(), signal));
    },

    // Version-checked update. data is the updated row, or null when the
    // version no longer matched (changed elsewhere, or deleted).
    async update(table, id, version, fields, signal) {
      const r = await call(() => {
        let q = client.from(table).update(fields).eq('id', id);
        if (version != null) q = q.eq('version', version);
        return withSignal(q.select(), signal);
      });
      if (!r.ok) return r;
      return { ok: true, data: Array.isArray(r.data) && r.data[0] ? r.data[0] : null };
    },

    async delete(table, id, version, signal) {
      const r = await call(() => {
        let q = client.from(table).delete().eq('id', id);
        if (version != null) q = q.eq('version', version);
        return withSignal(q.select('id'), signal);
      });
      if (!r.ok) return r;
      return { ok: true, data: Array.isArray(r.data) && r.data.length > 0 };
    },

    // Reads every row, page by page, so the server's row limit can never
    // silently truncate reports or hide an open session.
    async fetchAll(table, signal) {
      const rows = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const r = await call(() => withSignal(
          client.from(table).select('*').order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1), signal));
        if (!r.ok) return r;
        const page = Array.isArray(r.data) ? r.data : [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { ok: true, data: rows };
        if (from > 1_000_000) return { ok: false, error: { kind: 'rejected', message: 'Too many rows to load.', status: 0, code: 'TOO_MANY' } };
      }
    },

    async rpc(name, args, signal) {
      return call(() => withSignal(client.rpc(name, args), signal));
    },

    async deleteRow(table, id, signal) {
      const r = await call(() => withSignal(client.from(table).delete().eq('id', id).select('id'), signal));
      if (!r.ok) return r;
      return { ok: true, data: Array.isArray(r.data) ? r.data.length : 0 };
    },

    async updateRow(table, id, fields, signal) {
      const r = await call(() => withSignal(client.from(table).update(fields).eq('id', id).select(), signal));
      if (!r.ok) return r;
      if (!Array.isArray(r.data) || !r.data[0]) return { ok: false, error: { kind: 'rejected', message: 'Record not found on the server.', status: 404, code: 'NOT_FOUND' } };
      return { ok: true, data: r.data[0] };
    },
  };
}
