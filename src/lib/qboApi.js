// QuickBooks connection: calls to the qbo-connect Edge Function and handling
// of the return from Intuit's sign-in page. QuickBooks tokens never reach the
// browser; the app only ever sees a status (see qbo_status()).
import { SUPABASE_URL, accessTokenFor } from './supabaseClient.js';

const TIMEOUT_MS = 20000;
// The sign-in address comes from Intuit's discovery document on the server;
// the app still refuses to navigate anywhere that is not https on intuit.com.
export function isIntuitUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'intuit.com' || u.hostname.endsWith('.intuit.com'));
  } catch { return false; }
}

// Calls one of the QuickBooks Edge Functions. On failure, `code` is set when
// the server says what to do next: 'reconnect' or 'not_connected'.
async function callQbo(fn, uid, body, timeoutMs = TIMEOUT_MS) {
  let token;
  try { token = await accessTokenFor(uid); } catch { return { ok: false, error: 'QuickBooks needs internet and a signed-in session.' }; }
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await r.json().catch(() => null);
    if (r.status === 401) return { ok: false, error: 'Your session expired. Sign in again to use QuickBooks.' };
    if (r.status === 404) return { ok: false, error: 'QuickBooks is not set up on the server yet.' };
    // `uncertain`: the request may have been carried out even though it failed here.
    if (!r.ok) return { ok: false, error: data?.error || 'QuickBooks is temporarily unavailable. Try again.', code: data?.code || null, uncertain: r.status >= 500 };
    return { ok: true, data };
  } catch (e) {
    if (e?.name === 'TimeoutError') return { ok: false, error: 'QuickBooks took too long to respond. Try again.', uncertain: true };
    return { ok: false, error: 'No connection. QuickBooks needs internet.', uncertain: true };
  }
}

// Items and tax codes from the connected QuickBooks company, plus the
// current choices: { items, taxCodes, selected, company_name }.
export const loadQboOptions = uid => callQbo('qbo', uid, { action: 'options' });

export const saveQboSettings = (uid, settings) => callQbo('qbo', uid, { action: 'save-settings', settings });

const INVOICE_TIMEOUT_MS = 60000;

// Records the invoice (marks the hours billed) and creates it in QuickBooks.
// ok means the hours ARE recorded; data.qbo.ok says whether QuickBooks has it.
// Repeating the same request (same invoice id) is safe.
export const createQboInvoice = (uid, invoice, sessionIds, lines) =>
  callQbo('qbo', uid, { action: 'create-invoice', invoice, session_ids: sessionIds, lines }, INVOICE_TIMEOUT_MS);

// Sends an already-recorded invoice to QuickBooks again.
export const retryQboInvoice = (uid, invoiceId) => callQbo('qbo', uid, { action: 'retry-invoice', invoice_id: invoiceId }, INVOICE_TIMEOUT_MS);

// Voids the invoice in QuickBooks, then deletes the SiteLedger record (its
// hours go back to unbilled). If QuickBooks will not void it, nothing is
// deleted. code 'qbo_unavailable': it cannot be reached from this account.
export const deleteQboInvoice = (uid, invoiceId) => callQbo('qbo', uid, { action: 'delete-invoice', invoice_id: invoiceId }, INVOICE_TIMEOUT_MS);

// Can this account create invoices in QuickBooks right now? `status` is the
// qbo_status() result.
export function qboInvoiceMode(status) {
  if (!status?.connected || !status.invoices_ready) return 'off';
  if (status.status !== 'connected') return 'reconnect';
  return status.setup_complete ? 'ready' : 'setup';
}

// How an invoice relates to QuickBooks, for display.
//   manual  – recorded by hand        created – in QuickBooks
//   unsent  – recorded here, not in QuickBooks yet (can be retried)
//   voided  – voided or deleted in QuickBooks
export function qboInvoiceState(inv) {
  if (!inv?.qbo_status) return 'manual';
  if (inv.qbo_status === 'voided' || inv.qbo_status === 'deleted') return 'voided';
  if (inv.qbo_invoice_id || inv.qbo_status === 'created') return 'created';
  return 'unsent';
}

// "QuickBooks #1042", or the hand-typed number for invoices recorded by hand.
export function invoiceTitle(inv) {
  const state = qboInvoiceState(inv);
  if (state === 'manual') return inv?.notes || '—';
  if (state === 'unsent') return 'Not in QuickBooks yet';
  if (state === 'voided') return inv.qbo_doc_number ? `Voided in QuickBooks #${inv.qbo_doc_number}` : 'Voided in QuickBooks';
  return inv.qbo_doc_number ? `QuickBooks #${inv.qbo_doc_number}` : 'QuickBooks invoice';
}

// Returns the Intuit sign-in URL to send the browser to.
export async function startQboConnect(uid) {
  const r = await callQbo('qbo-connect', uid, { action: 'start' });
  if (!r.ok) return r;
  const url = r.data?.url;
  // Only ever navigate to Intuit, whatever the server answered.
  if (typeof url !== 'string' || !isIntuitUrl(url)) return { ok: false, error: 'QuickBooks sign-in could not be started. Try again.' };
  return { ok: true, data: { url } };
}

export const disconnectQbo = uid => callQbo('qbo-connect', uid, { action: 'disconnect' });

// "GST (5%)" for a tax code option from loadQboOptions.
export function taxCodeLabel(code) {
  if (!code) return '';
  return code.rate == null ? code.name : `${code.name} (${Number(code.rate)}%)`;
}

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
