// QuickBooks connect / disconnect for the signed-in account.
//
// POST { action: 'start' }       -> { url }  Intuit sign-in page to send the browser to
// POST { action: 'disconnect' }  -> { ok, revoked }
//
// verify_jwt = true (config.toml): the gateway rejects calls without a valid
// user JWT, and the account id is then confirmed with Supabase Auth. The
// connection status is read by the app through the qbo_status() database
// function, not here.
import {
  readConfig, corsHeaders, parseOrigins, getUserId, db, newState, hashState, authorizeUrl,
  importTokenKey, decryptToken, revokeToken, oauthEndpoints, STATE_TTL_MS,
} from '../_shared/qbo.ts';

const ALLOWED_ORIGINS = parseOrigins(Deno.env.get('ALLOWED_ORIGINS'));

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, ALLOWED_ORIGINS), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req, ALLOWED_ORIGINS) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(authHeader)) return json(req, { error: 'Sign in to connect QuickBooks.' }, 401);

  const conf = readConfig(n => Deno.env.get(n));
  if (!conf.ok) {
    console.error('qbo-connect: configuration problem:', conf.problems.join('; ')); // secret names only
    return json(req, { error: 'QuickBooks is not set up on the server yet.' }, 503);
  }
  const cfg = conf.cfg;

  let action: unknown;
  try { action = (await req.json())?.action; } catch { return json(req, { error: 'Invalid request.' }, 400); }
  if (action !== 'start' && action !== 'disconnect') return json(req, { error: 'Invalid request.' }, 400);

  try {
    const uid = await getUserId(cfg, authHeader);
    if (!uid) return json(req, { error: 'Your session expired. Sign in again.' }, 401);

    if (action === 'start') {
      const state = newState();
      // One unfinished attempt per account; also sweep anything expired.
      await db(cfg, `qbo_oauth_states?user_id=eq.${uid}`, { method: 'DELETE' });
      await db(cfg, `qbo_oauth_states?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' });
      const saved = await db(cfg, 'qbo_oauth_states', {
        method: 'POST',
        prefer: 'return=minimal',
        body: { state_hash: await hashState(state), user_id: uid, expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString() },
      });
      if (!saved.ok) return json(req, { error: 'QuickBooks is temporarily unavailable. Try again.' }, 503);
      return json(req, { url: authorizeUrl(cfg, state, (await oauthEndpoints(cfg)).authorize) });
    }

    // disconnect
    const found = await db(cfg, `qbo_connections?user_id=eq.${uid}&select=refresh_token_enc`);
    if (!found.ok) return json(req, { error: 'QuickBooks is temporarily unavailable. Try again.' }, 503);
    const row = (await found.json())?.[0];
    if (!row) return json(req, { ok: true, revoked: false });

    // Tell Intuit first (best effort), then forget the tokens either way.
    let revoked = false;
    try {
      const key = await importTokenKey(cfg.tokenKey);
      revoked = await revokeToken(cfg, await decryptToken(key, row.refresh_token_enc, uid));
    } catch { /* stored token unreadable; still remove it */ }
    const removed = await db(cfg, `qbo_connections?user_id=eq.${uid}`, { method: 'DELETE' });
    if (!removed.ok) return json(req, { error: 'Could not disconnect. Try again.' }, 503);
    return json(req, { ok: true, revoked });
  } catch (ex) {
    if (ex instanceof DOMException && ex.name === 'TimeoutError') return json(req, { error: 'QuickBooks took too long to respond. Try again.' }, 504);
    return json(req, { error: 'Something went wrong. Try again.' }, 500);
  }
});
