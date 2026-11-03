// Minimal stand-in for the Supabase Auth + PostgREST endpoints this app uses,
// for browser tests only. Enforces per-account ownership and row versions the
// way the real policies/triggers do. Synthetic data only.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, email, ttl) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return { token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp })}.sig`, exp };
}
function claims(req) {
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer /, '');
  try {
    const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    if (c.exp && c.exp * 1000 < Date.now()) return { expired: true };
    return c.sub ? c : null;
  } catch { return null; }
}

export function startMock({ port = 54321, tokenTtl = 3600 } = {}) {
  const users = new Map(); // email -> { id, email, password }
  const refresh = new Map(); // refresh token -> user id
  const tables = {};
  const t = name => (tables[name] ||= new Map());
  const log = [];
  let failNext = 0;
  const opts = { requireConfirmation: false };

  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,PUT,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  }
  function send(res, status, body, headers = {}) {
    cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  function session(user) {
    const { token, exp } = jwt(user.id, user.email, tokenTtl);
    const rt = randomUUID();
    refresh.set(rt, user.id);
    return { access_token: token, token_type: 'bearer', expires_in: tokenTtl, expires_at: exp, refresh_token: rt, user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [{}] } };
  }
  function filters(url) {
    const f = [];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      const m = v.match(/^(eq|in)\.(.*)$/);
      if (m) f.push([k, m[1], m[1] === 'in' ? m[2].replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')) : m[2]]);
    }
    return row => f.every(([k, op, val]) => (op === 'eq' ? String(row[k]) === val : val.includes(String(row[k]))));
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, `http://localhost:${port}`);
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    log.push(`${req.method} ${url.pathname}`);

    // ---- auth ----
    if (url.pathname === '/auth/v1/signup') {
      if (users.has(body.email)) return send(res, 200, { id: randomUUID(), email: body.email, identities: [] });
      const u = { id: randomUUID(), email: body.email, password: body.password };
      users.set(body.email, u);
      if (opts.requireConfirmation) return send(res, 200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', identities: [{ id: u.id }], confirmation_sent_at: new Date().toISOString() });
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
    if (url.pathname === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
        return send(res, 200, session(u));
      }
      if (grant === 'refresh_token') {
        const id = refresh.get(body.refresh_token);
        if (!id) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' });
        refresh.delete(body.refresh_token);
        return send(res, 200, session([...users.values()].find(u => u.id === id)));
      }
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/user') {
      const c = claims(req);
      if (!c || c.expired) return send(res, 401, { msg: 'invalid JWT' });
      if (req.method === 'PUT') {
        const u = [...users.values()].find(x => x.id === c.sub);
        if (body?.password) u.password = body.password;
      }
      return send(res, 200, { id: c.sub, email: c.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
    }

    // ---- rest ----
    if (!url.pathname.startsWith('/rest/v1/')) return send(res, 404, { message: 'not found' });
    const c = claims(req);
    if (c?.expired) return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
    if (!c) return send(res, 401, { code: '42501', message: 'permission denied' });
    if (failNext > 0) { failNext -= 1; return send(res, 503, { message: 'unavailable' }); }
    const uid = c.sub;
    const name = url.pathname.slice('/rest/v1/'.length);

    if (name === 'rpc/ledger_schema_version') return send(res, 200, 2);
    if (name === 'rpc/record_invoice') {
      const { p_invoice: inv, p_session_ids: ids, p_lines: lines } = body;
      if (t('invoices').has(inv.id)) return send(res, 200, { invoice: t('invoices').get(inv.id), lines: [...t('invoice_lines').values()].filter(l => l.invoice_id === inv.id), replayed: true });
      const sess = ids.map(id => t('sessions').get(id)).filter(s => s && s.user_id === uid);
      if (sess.length !== ids.length) return send(res, 404, { code: 'P0002', message: `${ids.length - sess.length} of ${ids.length} entries were not found on the server` });
      if (sess.some(s => s.invoice_id)) return send(res, 409, { code: '40001', message: 'already billed' });
      const row = { ...inv, user_id: uid, issued_at: new Date().toISOString(), version: 1 };
      t('invoices').set(inv.id, row);
      const saved = lines.map((l, i) => { const r = { ...l, id: randomUUID(), invoice_id: inv.id, user_id: uid, line_no: i + 1 }; t('invoice_lines').set(r.id, r); return r; });
      for (const s of sess) t('sessions').set(s.id, { ...s, invoice_id: inv.id, version: s.version + 1 });
      return send(res, 200, { invoice: row, lines: saved, replayed: false });
    }

    const rows = [...t(name).values()].filter(r => r.user_id === uid);
    const match = filters(url);
    const single = (req.headers.accept || '').includes('vnd.pgrst.object');
    if (req.method === 'GET') {
      let out = rows.filter(match).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const off = Number(url.searchParams.get('offset') || 0);
      const lim = url.searchParams.get('limit');
      out = out.slice(off, lim ? off + Number(lim) : undefined);
      if (single) return out.length ? send(res, 200, out[0]) : send(res, 406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
      return send(res, 200, out);
    }
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const out = [];
      for (const r of list) {
        if (r.user_id && r.user_id !== uid) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy' });
        if (t(name).has(r.id)) continue; // ignore-duplicates
        const row = { ...r, user_id: uid, version: 1, updated_at: new Date().toISOString(), invoice_id: name === 'sessions' ? null : r.invoice_id };
        t(name).set(row.id, row);
        out.push(row);
      }
      return send(res, 201, out);
    }
    if (req.method === 'PATCH') {
      const out = [];
      for (const r of rows.filter(match)) {
        const next = { ...r, ...body, id: r.id, user_id: r.user_id, version: r.version + 1, updated_at: new Date().toISOString() };
        t(name).set(r.id, next); out.push(next);
      }
      return send(res, 200, out);
    }
    if (req.method === 'DELETE') {
      const out = rows.filter(match);
      for (const r of out) {
        t(name).delete(r.id);
        if (name === 'invoices') for (const s of t('sessions').values()) if (s.invoice_id === r.id) t('sessions').set(s.id, { ...s, invoice_id: null, version: s.version + 1 });
      }
      return send(res, 200, out.map(r => ({ id: r.id })));
    }
    return send(res, 405, { message: 'method' });
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    server, tables, rows: n => [...t(n).values()], log,
    addUser(email, password) { const u = { id: randomUUID(), email, password }; users.set(email, u); return u; },
    failRequests(n) { failNext = n; },
    options: opts,
    revokeAllSessions() { refresh.clear(); },
    // Hash fragment of a password-recovery email link (implicit flow).
    recoveryHash(email) {
      const u = users.get(email);
      const s = session(u);
      return `#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=recovery`;
    },
    passwordOf: email => users.get(email)?.password,
    close: () => new Promise(r => server.close(r)),
  })));
}
