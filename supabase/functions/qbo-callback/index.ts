// Where Intuit sends the browser after the user approves (or cancels) the
// QuickBooks connection. Always answers with a redirect back to the app that
// carries only a result code: ?qbo=connected | cancelled | error&reason=...
//
// verify_jwt = false (config.toml): this is a browser redirect from Intuit, so
// there is no Supabase token. The request is tied to an account by the
// single-use `state` created in qbo-connect: it is random, stored only as a
// hash, expires in 10 minutes, and is deleted the moment it is used.
import {
  readConfig, db, hashState, exchangeCode, fetchCompanyInfo, importTokenKey, encryptToken,
  appReturnUrl, validRealmId, validAuthCode, validState, type ReturnResult,
} from '../_shared/qbo.ts';

Deno.serve(async req => {
  const conf = readConfig(n => Deno.env.get(n));
  if (!conf.ok) {
    console.error('qbo-callback: configuration problem:', conf.problems.join('; ')); // secret names only
    return new Response('QuickBooks is not set up on the server yet.', { status: 503 });
  }
  const cfg = conf.cfg;
  const back = (result: ReturnResult, reason?: string) => new Response(null, {
    status: 303,
    headers: { Location: appReturnUrl(cfg.appUrl, result, reason), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
  if (req.method !== 'GET') return new Response('Method not allowed.', { status: 405 });

  try {
    const q = new URL(req.url).searchParams;
    const state = q.get('state');
    if (!validState(state)) return back('error', 'invalid_state');

    // Use up the state: deleting and reading it in one statement means a
    // second request with the same state finds nothing.
    const used = await db(cfg, `qbo_oauth_states?state_hash=eq.${await hashState(state)}`, { method: 'DELETE', prefer: 'return=representation' });
    if (!used.ok) return back('error', 'server');
    const pending = (await used.json())?.[0];
    if (!pending || !(Date.parse(pending.expires_at) > Date.now())) return back('error', 'invalid_state');
    const uid: string = pending.user_id;

    if (q.get('error')) return q.get('error') === 'access_denied' ? back('cancelled') : back('error', 'denied');

    const code = q.get('code');
    const realmId = q.get('realmId');
    if (!validAuthCode(code) || !validRealmId(realmId)) return back('error', 'invalid_response');

    const tokens = await exchangeCode(cfg, code);
    if (!tokens) return back('error', 'exchange_failed');
    const company = await fetchCompanyInfo(cfg, realmId, tokens.accessToken);

    const key = await importTokenKey(cfg.tokenKey);
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      user_id: uid,
      realm_id: realmId,
      environment: cfg.env,
      access_token_enc: await encryptToken(key, tokens.accessToken, uid),
      refresh_token_enc: await encryptToken(key, tokens.refreshToken, uid),
      access_expires_at: tokens.accessExpiresAt,
      refresh_expires_at: tokens.refreshExpiresAt,
      status: 'connected',
      company_name: company?.name ?? null,
      country: company?.country ?? null,
      connected_at: now,
      updated_at: now,
    };

    // Item and tax-code choices belong to one QuickBooks company: keep them
    // when reconnecting the same company, clear them when switching.
    const prior = await db(cfg, `qbo_connections?user_id=eq.${uid}&select=realm_id,environment`);
    if (!prior.ok) return back('error', 'server');
    const existing = (await prior.json())?.[0];
    if (existing && (existing.realm_id !== realmId || existing.environment !== cfg.env)) {
      Object.assign(row, { labour_item_id: null, half_day_item_id: null, full_day_item_id: null, tax_code_id: null });
    }

    const saved = await db(cfg, 'qbo_connections?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: row });
    // 409: this QuickBooks company is already connected to another account.
    if (saved.status === 409) return back('error', 'company_in_use');
    if (!saved.ok) return back('error', 'server');
    return back('connected');
  } catch {
    return back('error', 'server');
  }
});
