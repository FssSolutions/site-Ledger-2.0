import { SUPABASE_URL, accessTokenFor } from './supabaseClient.js';

const TIMEOUT_MS = 60000;

// Sends a recording for transcription + extraction. Returns { ok, data } or
// { ok: false, error }. Cancelled via `signal` (e.g. the modal was closed).
export async function processVoiceEntry(uid, blob, { jobs, customers, elapsedSeconds, defaultStart = '08:00' }, signal) {
  let token;
  try { token = await accessTokenFor(uid); } catch { return { ok: false, error: 'Voice entries need internet and a signed-in session.' }; }
  const form = new FormData();
  form.append('audio', blob, `voice-entry.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('jobs', JSON.stringify(jobs.slice(0, 200).map(j => ({ id: j.id, name: String(j.name || '').slice(0, 120), address: String(j.address || '').slice(0, 200) }))));
  form.append('customers', JSON.stringify(customers.slice(0, 500).map(c => ({ id: c.id, name: String(c.name || '').slice(0, 120) }))));
  form.append('now', new Date().toISOString());
  form.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Vancouver');
  form.append('defaultStart', defaultStart);
  if (elapsedSeconds) form.append('elapsedSeconds', String(Math.min(600, Math.round(elapsedSeconds))));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
  const onAbort = () => ctl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/voice-entry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: form,
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => null);
    if (r.status === 401) return { ok: false, error: 'Your session expired. Sign in again to use voice entry.' };
    if (r.status === 429) return { ok: false, error: data?.error || 'Voice entry limit reached for now. Try again later or enter it manually.' };
    if (!r.ok) return { ok: false, error: data?.error || 'Voice processing failed. You can enter it manually.' };
    return { ok: true, data };
  } catch (e) {
    if (signal?.aborted) return { ok: false, cancelled: true, error: 'Cancelled.' };
    if (e?.name === 'TimeoutError' || ctl.signal.reason?.name === 'TimeoutError') return { ok: false, error: 'Voice processing took too long. Try again or enter it manually.' };
    return { ok: false, error: 'No connection. Voice entries need internet; manual entries work offline.' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
