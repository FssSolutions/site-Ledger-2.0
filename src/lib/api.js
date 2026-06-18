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
  async upsert(t, table, body) {
    try {
      const r = await fetch(`${SURL}/rest/v1/${table}`, { method: 'POST', headers: { ...AH(t), Prefer: 'return=representation,resolution=merge-duplicates' }, body: JSON.stringify(body) });
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
  async processVoiceEntry(t, audioBlob, { jobs, customers, now, timezone, defaultStart = '08:00', elapsedSeconds } = {}) {
    try {
      const form = new FormData();
      form.append('audio', audioBlob, `voice-entry.${audioBlob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      form.append('jobs', JSON.stringify(jobs || []));
      form.append('customers', JSON.stringify(customers || []));
      form.append('now', now || new Date().toISOString());
      form.append('timezone', timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Vancouver');
      form.append('defaultStart', defaultStart);
      if (elapsedSeconds) form.append('elapsedSeconds', String(elapsedSeconds));

      const r = await fetch(`${SURL}/functions/v1/voice-entry`, {
        method: 'POST',
        headers: { apikey: SKEY, Authorization: `Bearer ${t}` },
        body: form,
      });
      if (r.status === 401) return { _expired: true };
      const data = await r.json().catch(() => null);
      if (!r.ok) return { error: { message: data?.error || 'Voice processing failed.' } };
      return data;
    } catch (ex) {
      return { error: { message: 'Network error: ' + ex.message } };
    }
  },
};
