const SURL = import.meta.env.VITE_SUPABASE_URL;
const SKEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const BH = { 'Content-Type': 'application/json', apikey: SKEY };
const AH = t => ({ ...BH, Authorization: `Bearer ${t}` });

export const api = {
  async signUp(e, p) {
    try {
      const r = await fetch(`${SURL}/auth/v1/signup`, { method: 'POST', headers: BH, body: JSON.stringify({ email: e, password: p }) });
      return r.json();
    } catch (ex) { return { error: { message: 'Network error: ' + ex.message } }; }
  },
  async signIn(e, p) {
    try {
      const r = await fetch(`${SURL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: BH, body: JSON.stringify({ email: e, password: p }) });
      return r.json();
    } catch (ex) { return { error: { message: 'Network error: ' + ex.message } }; }
  },
  async signOut(t) {
    try { await fetch(`${SURL}/auth/v1/logout`, { method: 'POST', headers: AH(t) }); } catch {}
  },
  async user(t) {
    const r = await fetch(`${SURL}/auth/v1/user`, { headers: AH(t) });
    return r.json();
  },
  async select(t, table, qs = '') {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}?select=*${qs}&order=created_at.asc`, { headers: AH(t) });
      return r.json();
    } catch { return []; }
  },
  async insert(t, table, body) {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}`, { method: 'POST', headers: { ...AH(t), Prefer: 'return=representation' }, body: JSON.stringify(body) });
      return r.json();
    } catch { return null; }
  },
  async update(t, table, id, body) {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}?id=eq.${id}`, { method: 'PATCH', headers: { ...AH(t), Prefer: 'return=representation' }, body: JSON.stringify(body) });
      return r.json();
    } catch { return null; }
  },
  async delete(t, table, id) {
    try { await fetch(`${SURL}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: AH(t) }); } catch {}
  },
};
