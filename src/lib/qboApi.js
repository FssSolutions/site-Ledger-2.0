// QuickBooks connection: calls to the qbo-connect Edge Function and handling
// of the return from Intuit's sign-in page. QuickBooks tokens never reach the
// browser; the app only ever sees a status (see qbo_status()).
import { SUPABASE_URL, accessTokenFor } from './supabaseClient.js';

const TIMEOUT_MS = 20000;
const INTUIT_SIGN_IN = 'https://appcenter.intuit.com/';

async function callQbo(uid, action) {
  let token;
  try { token = await accessTokenFor(uid); } catch { return { ok: false, error: 'QuickBooks needs internet and a signed-in session.' }; }
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/qbo-connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await r.json().catch(() => null);
    if (r.status === 401) return { ok: false, error: 'Your session expired. Sign in again to connect QuickBooks.' };
    if (r.status === 404) return { ok: false, error: 'QuickBooks is not set up on the server yet.' };
    if (!r.ok) return { ok: false, error: data?.error || 'QuickBooks is temporarily unavailable. Try again.' };
    return { ok: true, data };
  } catch (e) {
    if (e?.name === 'TimeoutError') return { ok: false, error: 'QuickBooks took too long to respond. Try again.' };
    return { ok: false, error: 'No connection. QuickBooks needs internet.' };
  }
}

// Returns the Intuit sign-in URL to send the browser to.
export async function startQboConnect(uid) {
  const r = await callQbo(uid, 'start');
  if (!r.ok) return r;
  const url = r.data?.url;
  // Only ever navigate to Intuit, whatever the server answered.
  if (typeof url !== 'string' || !url.startsWith(INTUIT_SIGN_IN)) return { ok: false, error: 'QuickBooks sign-in could not be started. Try again.' };
  return { ok: true, data: { url } };
}

export const disconnectQbo = uid => callQbo(uid, 'disconnect');

// ---- return from Intuit -----------------------------------------------------
// qbo-callback redirects to the app with ?qbo=connected|cancelled|error and an
// optional &reason=. Nothing secret is in the URL.

const RESULTS = new Set(['connected', 'cancelled', 'error']);

export function readQboReturn(loc = globalThis.location) {
  try {
    const q = new URLSearchParams(loc?.search || '');
    const result = q.get('qbo');
    if (!RESULTS.has(result)) return null;
    return { result, reason: q.get('reason') || null };
  } catch { return null; }
}

export function clearQboReturn(win = globalThis.window) {
  try {
    const q = new URLSearchParams(win.location.search);
    q.delete('qbo');
    q.delete('reason');
    const rest = q.toString();
    win.history.replaceState(null, '', win.location.pathname + (rest ? `?${rest}` : '') + win.location.hash);
  } catch { /* ignore */ }
}

const REASONS = {
  invalid_state: 'That QuickBooks sign-in expired or was already used. Tap Connect QuickBooks to try again.',
  company_in_use: 'That QuickBooks company is already connected to a different SiteLedger account. Disconnect it there first.',
  exchange_failed: 'QuickBooks did not complete the sign-in. Try connecting again.',
  invalid_response: 'QuickBooks sent back an incomplete answer. Try connecting again.',
  denied: 'QuickBooks did not allow the connection. Try again.',
};

export function qboReturnMessage(ret) {
  if (!ret) return null;
  if (ret.result === 'connected') return { message: 'QuickBooks connected.', type: 'success' };
  if (ret.result === 'cancelled') return { message: 'QuickBooks connection cancelled. Nothing was changed.', type: 'info' };
  return { message: REASONS[ret.reason] || 'QuickBooks could not be connected. Try again in a moment.', type: 'error' };
}
