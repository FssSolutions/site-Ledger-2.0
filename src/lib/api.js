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
  async refreshToken(refreshToken) {
    try {
      const r = await fetch(`${SURL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: BH,
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      return r.json();
    } catch (ex) { return { error: { message: 'Network error: ' + ex.message } }; }
  },
  async resetPassword(email) {
    try {
      const r = await fetch(`${SURL}/auth/v1/recover`, {
        method: 'POST', headers: BH,
        body: JSON.stringify({ email }),
      });
      return r.json();
    } catch (ex) { return { error: { message: 'Network error: ' + ex.message } }; }
  },
  async updatePassword(token, newPassword) {
    try {
      const r = await fetch(`${SURL}/auth/v1/user`, {
        method: 'PUT', headers: AH(token),
        body: JSON.stringify({ password: newPassword }),
      });
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
      if (r.status === 401) return { _expired: true };
      return r.json();
    } catch { return []; }
  },
  async insert(t, table, body) {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}`, { method: 'POST', headers: { ...AH(t), Prefer: 'return=representation' }, body: JSON.stringify(body) });
      if (r.status === 401) return { _expired: true };
      return r.json();
    } catch { return null; }
  },
  async update(t, table, id, body) {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}?id=eq.${id}`, { method: 'PATCH', headers: { ...AH(t), Prefer: 'return=representation' }, body: JSON.stringify(body) });
      if (r.status === 401) return { _expired: true };
      return r.json();
    } catch { return null; }
  },
  async delete(t, table, id) {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: AH(t) });
      if (r.status === 401) return { _expired: true };
    } catch {}
  },
};
