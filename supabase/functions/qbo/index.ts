// QuickBooks actions for the signed-in, connected account.
//
// POST { action: 'options' }
//   -> { items, taxCodes, selected, company_name }  choices for invoice setup
// POST { action: 'save-settings', settings: { labour_item_id, half_day_item_id, full_day_item_id, tax_code_id } }
//   -> { ok: true, selected }
// POST { action: 'create-invoice', invoice, session_ids, lines }
//   Records the invoice (record_invoice(), as the caller) and then creates it
//   in QuickBooks.
//   -> { invoice, lines, replayed, qbo: { ok, error } }
//   A 200 means the hours ARE recorded as billed, whatever qbo.ok says; any
//   other status means nothing was recorded.
// POST { action: 'retry-invoice', invoice_id }
//   Sends an already-recorded invoice to QuickBooks again.
//   -> { invoice, qbo: { ok, error } }
//
// verify_jwt = true (config.toml); the account id is confirmed with Supabase
// Auth. Errors carry a `code` the app can act on:
//   not_connected – connect QuickBooks first
//   reconnect     – QuickBooks access expired or was removed; connect again
//   setup         – choose the invoice item and tax code first
import {
  readConfig, corsHeaders, parseOrigins, getUserId, db, loadConnection, qboQuery, pickItems, pickTaxCodes,
  checkSettings, QboError, type QboConfig, type Connection,
} from '../_shared/qbo.ts';
import { pushInvoice, userDb, UUID, type CustomerRow } from '../_shared/invoice.ts';

const ALLOWED_ORIGINS = parseOrigins(Deno.env.get('ALLOWED_ORIGINS'));
const ACTIONS = new Set(['options', 'save-settings', 'create-invoice', 'retry-invoice']);
const MAX_LINES = 500;

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, ALLOWED_ORIGINS), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// A response to hand straight back to the app.
class Reply extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? status));
    this.status = status;
    this.body = body;
  }
}

async function readOptions(cfg: QboConfig, conn: Connection) {
  const [items, codes, rates] = await Promise.all([
    qboQuery(cfg, conn, 'select * from Item where Active = true maxresults 1000'),
    qboQuery(cfg, conn, 'select * from TaxCode maxresults 1000'),
    qboQuery(cfg, conn, 'select * from TaxRate maxresults 1000'),
  ]);
  return { items: pickItems(items), taxCodes: pickTaxCodes(codes, rates) };
}

function requireSetup(conn: Connection) {
  if (!conn.settings.labour_item_id || !conn.settings.tax_code_id) {
    throw new Reply(409, { error: 'Finish QuickBooks invoice setup first (Company → Profile).', code: 'setup' });
  }
}

// Reads one of the caller's own rows (RLS applies). null when not found.
async function ownRow(cfg: QboConfig, authHeader: string, path: string) {
  const r = await userDb(cfg, authHeader, path);
  if (r.status === 401) { await r.body?.cancel(); throw new Reply(401, { error: 'Your session expired. Sign in again.' }); }
  if (!r.ok) { await r.body?.cancel(); throw new Reply(503, { error: 'Could not read your records. Try again.' }); }
  return await r.json();
}

async function ownCustomer(cfg: QboConfig, authHeader: string, id: unknown): Promise<CustomerRow> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Reply(400, { error: 'Choose a customer for the QuickBooks invoice.' });
  const c = (await ownRow(cfg, authHeader, `customers?id=eq.${id}&select=id,name,email,phone,address`))?.[0];
  if (!c) throw new Reply(400, { error: 'That customer was not found on the server. Sync, then try again.' });
  return c;
}

// deno-lint-ignore no-explicit-any
async function createInvoice(cfg: QboConfig, authHeader: string, uid: string, body: any) {
  const inv = body?.invoice;
  const ids = body?.session_ids;
  const lines = body?.lines;
  if (!inv || typeof inv !== 'object' || typeof inv.id !== 'string' || !UUID.test(inv.id)
    || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_LINES || !ids.every(x => typeof x === 'string' && UUID.test(x))
    || !Array.isArray(lines) || lines.length !== ids.length) {
    throw new Reply(400, { error: 'Invalid request.' });
  }

  // Everything that can stop us is checked BEFORE the hours are claimed.
  const conn = await loadConnection(cfg, uid);
  requireSetup(conn);
  const customer = await ownCustomer(cfg, authHeader, inv.customer_id);

  const rpc = await userDb(cfg, authHeader, 'rpc/record_invoice', { method: 'POST', body: { p_invoice: inv, p_session_ids: ids, p_lines: lines } });
  const rec = await rpc.json().catch(() => null);
  if (!rpc.ok) {
    if (rpc.status === 401) throw new Reply(401, { error: 'Your session expired. Sign in again.' });
    if (rpc.status >= 500) throw new Reply(503, { error: 'The server could not record the invoice. Nothing was recorded; try again.' });
    throw new Reply(409, { error: typeof rec?.message === 'string' ? rec.message.slice(0, 300) : 'The invoice could not be recorded.' });
  }
  if (!rec?.invoice?.id) throw new Reply(503, { error: 'The server could not record the invoice. Try again.' });

  const result = await pushInvoice(cfg, conn, rec.invoice, rec.lines || [], customer);
  return { invoice: result.invoice, lines: rec.lines || [], replayed: !!rec.replayed, qbo: { ok: result.ok, error: result.error } };
}

// deno-lint-ignore no-explicit-any
async function retryInvoice(cfg: QboConfig, authHeader: string, uid: string, body: any) {
  const id = body?.invoice_id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new Reply(400, { error: 'Invalid request.' });
  const invoice = (await ownRow(cfg, authHeader, `invoices?id=eq.${id}&select=*`))?.[0];
  if (!invoice) throw new Reply(404, { error: 'That invoice was not found.' });
  if (invoice.qbo_invoice_id) return { invoice, qbo: { ok: true, error: null } };
  if (!invoice.issued_at || (invoice.qbo_status !== 'pending' && invoice.qbo_status !== 'failed')) {
    throw new Reply(400, { error: 'This invoice was recorded by hand, so it is not sent to QuickBooks.' });
  }
  const conn = await loadConnection(cfg, uid);
  requireSetup(conn);
  if (!invoice.customer_id) throw new Reply(400, { error: 'This invoice has no customer, so it cannot be sent to QuickBooks.' });
  const customer = await ownCustomer(cfg, authHeader, invoice.customer_id);
  const lines = await ownRow(cfg, authHeader, `invoice_lines?invoice_id=eq.${id}&select=*&order=line_no.asc`);
  if (!Array.isArray(lines) || lines.length === 0) throw new Reply(400, { error: 'This invoice has no stored lines to send.' });
  const result = await pushInvoice(cfg, conn, invoice, lines, customer);
  return { invoice: result.invoice, qbo: { ok: result.ok, error: result.error } };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req, ALLOWED_ORIGINS) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(authHeader)) return json(req, { error: 'Sign in to use QuickBooks.' }, 401);

  const conf = readConfig(n => Deno.env.get(n));
  if (!conf.ok) {
    console.error('qbo: configuration problem:', conf.problems.join('; ')); // secret names only
    return json(req, { error: 'QuickBooks is not set up on the server yet.' }, 503);
  }
  const cfg = conf.cfg;

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: 'Invalid request.' }, 400); }
  const action = body?.action;
  if (!ACTIONS.has(action)) return json(req, { error: 'Invalid request.' }, 400);

  try {
    const uid = await getUserId(cfg, authHeader);
    if (!uid) return json(req, { error: 'Your session expired. Sign in again.' }, 401);

    if (action === 'create-invoice') return json(req, await createInvoice(cfg, authHeader, uid, body));
    if (action === 'retry-invoice') return json(req, await retryInvoice(cfg, authHeader, uid, body));

    const conn = await loadConnection(cfg, uid);
    const options = await readOptions(cfg, conn);
    if (action === 'options') {
      return json(req, { ...options, selected: conn.settings, company_name: conn.companyName });
    }

    // save-settings: only ids that exist in this QuickBooks company right now.
    const checked = checkSettings(body?.settings, options.items, options.taxCodes);
    if (!checked.ok) return json(req, { error: checked.error }, 400);
    const saved = await db(cfg, `qbo_connections?user_id=eq.${uid}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { ...checked.settings, updated_at: new Date().toISOString() },
    });
    if (!saved.ok) return json(req, { error: 'Could not save. Try again.' }, 503);
    return json(req, { ok: true, selected: checked.settings });
  } catch (ex) {
    if (ex instanceof Reply) return json(req, ex.body, ex.status);
    if (ex instanceof QboError) {
      if (ex.kind === 'not_connected') return json(req, { error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);
      if (ex.kind === 'reconnect') return json(req, { error: 'QuickBooks access expired or was removed. Reconnect QuickBooks to continue.', code: 'reconnect' }, 409);
      return json(req, { error: 'QuickBooks is temporarily unavailable. Try again in a moment.' }, 503);
    }
    if (ex instanceof DOMException && ex.name === 'TimeoutError') return json(req, { error: 'The server took too long to respond. Try again.' }, 504);
    return json(req, { error: 'Something went wrong. Try again.' }, 500);
  }
});
