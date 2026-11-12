// QuickBooks actions for the signed-in, connected account.
//
// POST { action: 'options' }
//   -> { items, taxCodes, selected, company_name }  choices for invoice setup
// POST { action: 'save-settings', settings: { labour_item_id, half_day_item_id, full_day_item_id, tax_code_id } }
//   -> { ok: true, selected }
//
// verify_jwt = true (config.toml); the account id is confirmed with Supabase
// Auth. Errors carry a `code` the app can act on:
//   not_connected – connect QuickBooks first
//   reconnect     – QuickBooks access expired or was removed; connect again
import {
  readConfig, corsHeaders, parseOrigins, getUserId, db, loadConnection, qboQuery, pickItems, pickTaxCodes,
  checkSettings, QboError, type QboConfig, type Connection,
} from '../_shared/qbo.ts';

const ALLOWED_ORIGINS = parseOrigins(Deno.env.get('ALLOWED_ORIGINS'));

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, ALLOWED_ORIGINS), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readOptions(cfg: QboConfig, conn: Connection) {
  const [items, codes, rates] = await Promise.all([
    qboQuery(cfg, conn, 'select * from Item where Active = true maxresults 1000'),
    qboQuery(cfg, conn, 'select * from TaxCode maxresults 1000'),
    qboQuery(cfg, conn, 'select * from TaxRate maxresults 1000'),
  ]);
  return { items: pickItems(items), taxCodes: pickTaxCodes(codes, rates) };
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
  if (action !== 'options' && action !== 'save-settings') return json(req, { error: 'Invalid request.' }, 400);

  try {
    const uid = await getUserId(cfg, authHeader);
    if (!uid) return json(req, { error: 'Your session expired. Sign in again.' }, 401);

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
    if (ex instanceof QboError) {
      if (ex.kind === 'not_connected') return json(req, { error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);
      if (ex.kind === 'reconnect') return json(req, { error: 'QuickBooks access expired or was removed. Reconnect QuickBooks to continue.', code: 'reconnect' }, 409);
      return json(req, { error: 'QuickBooks is temporarily unavailable. Try again in a moment.' }, 503);
    }
    if (ex instanceof DOMException && ex.name === 'TimeoutError') return json(req, { error: 'QuickBooks took too long to respond. Try again.' }, 504);
    return json(req, { error: 'Something went wrong. Try again.' }, 500);
  }
});
