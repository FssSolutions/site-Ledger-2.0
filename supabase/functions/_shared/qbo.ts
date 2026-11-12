// Shared QuickBooks Online helpers for the Edge Functions.
//
// Security notes
//  * QuickBooks tokens can read and write the user's books. They are only
//    ever handled here, on the server, and are stored encrypted (AES-GCM)
//    with a key that lives in Edge Function secrets, bound to the owning
//    account id so a ciphertext copied to another row does not decrypt.
//  * The service-role key is used only by these functions, only to reach the
//    two qbo_* tables that app users cannot access.
//  * Nothing here logs tokens, authorization codes or states.
//
// This module has no Deno-specific code at import time, so the pure parts are
// unit-tested with Vitest (qbo.test.ts).

export const INTUIT = {
  authorize: 'https://appcenter.intuit.com/connect/oauth2',
  token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
  api: {
    sandbox: 'https://sandbox-quickbooks.api.intuit.com',
    production: 'https://quickbooks.api.intuit.com',
  },
} as const;

// Intuit's discovery documents list the current OAuth addresses. They are
// read at run time (see oauthEndpoints); the addresses in INTUIT above are
// only the fallback when a document cannot be fetched.
export const DISCOVERY = {
  sandbox: 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration',
  production: 'https://developer.api.intuit.com/.well-known/openid_configuration',
} as const;

export const SCOPE = 'com.intuit.quickbooks.accounting';
export const MINOR_VERSION = '75';
export const STATE_TTL_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 15_000;

export type QboEnv = 'sandbox' | 'production';

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  env: QboEnv;
  redirectUri: string;
  appUrl: string;
  tokenKey: string;
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
}

export type ConfigResult = { ok: true; cfg: QboConfig } | { ok: false; problems: string[] };

function isUrl(v: string, httpsOnly: boolean) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:');
  } catch {
    return false;
  }
}

// Reads and validates configuration. `get` is Deno.env.get in production.
// `problems` lists secret NAMES only, never values.
export function readConfig(get: (name: string) => string | undefined): ConfigResult {
  const v = (n: string) => (get(n) || '').trim();
  const problems: string[] = [];
  for (const n of ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENV', 'QBO_REDIRECT_URI', 'QBO_TOKEN_KEY', 'APP_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
    if (!v(n)) problems.push(`${n} is not set`);
  }
  const env = v('QBO_ENV');
  if (env && env !== 'sandbox' && env !== 'production') problems.push('QBO_ENV must be sandbox or production');
  if (v('QBO_REDIRECT_URI') && !isUrl(v('QBO_REDIRECT_URI'), true)) problems.push('QBO_REDIRECT_URI must be an https URL');
  if (v('APP_URL') && !isUrl(v('APP_URL'), false)) problems.push('APP_URL must be a URL');
  if (v('QBO_TOKEN_KEY')) {
    let len = -1;
    try { len = b64decode(v('QBO_TOKEN_KEY')).length; } catch { /* reported below */ }
    if (len !== 32) problems.push('QBO_TOKEN_KEY must be 32 random bytes, base64-encoded');
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    cfg: {
      clientId: v('QBO_CLIENT_ID'),
      clientSecret: v('QBO_CLIENT_SECRET'),
      env: env as QboEnv,
      redirectUri: v('QBO_REDIRECT_URI'),
      appUrl: v('APP_URL').replace(/\/+$/, ''),
      tokenKey: v('QBO_TOKEN_KEY'),
      supabaseUrl: v('SUPABASE_URL').replace(/\/+$/, ''),
      serviceKey: v('SUPABASE_SERVICE_ROLE_KEY'),
      anonKey: v('SUPABASE_ANON_KEY'),
    },
  };
}

// ---- Intuit OAuth addresses and error logging --------------------------------

export interface OAuthEndpoints { authorize: string; token: string; revoke: string }

function isIntuitUrl(v: unknown): v is string {
  try {
    const u = new URL(v as string);
    return u.protocol === 'https:' && (u.hostname === 'intuit.com' || u.hostname.endsWith('.intuit.com'));
  } catch {
    return false;
  }
}

// Accepts a discovery document only if every address is an https Intuit one.
export function parseDiscovery(doc: unknown): OAuthEndpoints | null {
  const d = doc as Record<string, unknown> | null;
  if (!d || !isIntuitUrl(d.authorization_endpoint) || !isIntuitUrl(d.token_endpoint) || !isIntuitUrl(d.revocation_endpoint)) return null;
  return { authorize: d.authorization_endpoint, token: d.token_endpoint, revoke: d.revocation_endpoint };
}

const ENDPOINT_TTL_MS = 6 * 60 * 60 * 1000;
const endpointCache = new Map<string, { at: number; value: OAuthEndpoints }>();

// Current OAuth addresses from Intuit's discovery document, cached for a few
// hours. Falls back to the known addresses if the document is unavailable.
export async function oauthEndpoints(cfg: Pick<QboConfig, 'env'>): Promise<OAuthEndpoints> {
  const hit = endpointCache.get(cfg.env);
  if (hit && Date.now() - hit.at < ENDPOINT_TTL_MS) return hit.value;
  try {
    const r = await fetch(DISCOVERY[cfg.env], { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const parsed = parseDiscovery(await r.json());
      if (parsed) {
        endpointCache.set(cfg.env, { at: Date.now(), value: parsed });
        return parsed;
      }
    } else {
      await r.body?.cancel();
    }
  } catch { /* fall back below */ }
  return { authorize: INTUIT.authorize, token: INTUIT.token, revoke: INTUIT.revoke };
}

// Intuit's id for one request (the intuit_tid response header). Intuit
// support uses it to find the request on their side.
export function intuitTid(r: Response) {
  const t = r.headers.get('intuit_tid');
  return t && /^[\w-]{1,80}$/.test(t) ? t : null;
}

// One log line per failed QuickBooks request, for troubleshooting with Intuit
// support. Holds only the kind of request, the HTTP status, Intuit's request
// id and error codes: never tokens, query text, names or amounts.
export function logQboError(where: string, r: Response, extra: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ source: 'quickbooks', where, status: r.status, intuit_tid: intuitTid(r), ...extra }));
}

const errorCode = (v: unknown) => (typeof v === 'string' && /^[\w.-]{1,60}$/.test(v) ? v : null);

// ---- encoding ---------------------------------------------------------------

export function b64encode(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64decode(text: string) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (bytes: Uint8Array) => b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- token encryption -------------------------------------------------------

export async function importTokenKey(b64: string) {
  const raw = b64decode(b64);
  if (raw.length !== 32) throw new Error('token key must be 32 bytes');
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Returns "v1:<iv>:<ciphertext>". `aad` (the owning account id) is
// authenticated but not stored, so the value only decrypts for that account.
export async function encryptToken(key: CryptoKey, plaintext: string, aad: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(plaintext));
  return `v1:${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

export async function decryptToken(key: CryptoKey, value: string, aad: string) {
  const [version, iv, ct] = String(value).split(':');
  if (version !== 'v1' || !iv || !ct) throw new Error('unrecognised token format');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv), additionalData: new TextEncoder().encode(aad) }, key, b64decode(ct));
  return new TextDecoder().decode(pt);
}

// ---- OAuth state ------------------------------------------------------------

export function newState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

// Only the hash is stored, so a leaked database row cannot be replayed.
export async function hashState(state: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function authorizeUrl(cfg: Pick<QboConfig, 'clientId' | 'redirectUri'>, state: string, endpoint: string = INTUIT.authorize) {
  const u = new URL(endpoint);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export const validRealmId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,30}$/.test(v);
export const validAuthCode = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512;
export const validState = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(v);

export type ReturnResult = 'connected' | 'cancelled' | 'error';

// Where the browser lands after Intuit: the app, with only a result code.
export function appReturnUrl(appUrl: string, result: ReturnResult, reason?: string) {
  const u = new URL(appUrl.replace(/\/+$/, '') + '/');
  u.searchParams.set('qbo', result);
  if (reason) u.searchParams.set('reason', reason);
  return u.toString();
}

// ---- Intuit -----------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string | null;
}

export function parseTokenResponse(data: unknown, nowMs: number): TokenSet | null {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d.access_token !== 'string' || !d.access_token || typeof d.refresh_token !== 'string' || !d.refresh_token) return null;
  const expiresIn = Number(d.expires_in);
  const refreshIn = Number(d.x_refresh_token_expires_in);
  // Treat the access token as expiring a minute early so it is never used
  // right at its limit.
  const accessMs = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.max(0, expiresIn - 60) * 1000 : 0;
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    accessExpiresAt: new Date(nowMs + accessMs).toISOString(),
    refreshExpiresAt: Number.isFinite(refreshIn) && refreshIn > 0 ? new Date(nowMs + refreshIn * 1000).toISOString() : null,
  };
}

const basicAuth = (cfg: QboConfig) => `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`;

export async function exchangeCode(cfg: QboConfig, code: string): Promise<TokenSet | null> {
  const r = await fetch((await oauthEndpoints(cfg)).token, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) { logQboError('oauth:exchange', r, { error: errorCode(data?.error) }); return null; }
  return parseTokenResponse(data, Date.now());
}

// Ends the connection at Intuit. Best effort: returns false on any failure.
export async function revokeToken(cfg: QboConfig, token: string) {
  try {
    const r = await fetch((await oauthEndpoints(cfg)).revoke, {
      method: 'POST',
      headers: { Authorization: basicAuth(cfg), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!r.ok) logQboError('oauth:revoke', r);
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

// Company name and country for display. Best effort: null on any failure.
export async function fetchCompanyInfo(cfg: QboConfig, realmId: string, accessToken: string) {
  try {
    const r = await fetch(`${INTUIT.api[cfg.env]}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!r.ok) { logQboError('companyinfo', r); await r.body?.cancel(); return null; }
    const info = (await r.json())?.CompanyInfo;
    const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 200) : null);
    return { name: text(info?.CompanyName), country: text(info?.Country) };
  } catch {
    return null;
  }
}

// ---- Supabase ---------------------------------------------------------------

// Service-role request to PostgREST. Used ONLY for the qbo_* tables.
export function db(cfg: QboConfig, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  return fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
}

// The signed-in account, confirmed by Supabase Auth from the caller's token.
export async function getUserId(cfg: QboConfig, authHeader: string): Promise<string | null> {
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, Authorization: authHeader },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const id = (await r.json())?.id;
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

// ---- using a stored connection ----------------------------------------------

export type QboErrorKind = 'not_connected' | 'reconnect' | 'unavailable';

// not_connected – this account has no QuickBooks connection.
// reconnect     – Intuit no longer accepts the stored access; the user must
//                 connect again.
// unavailable   – temporary (network, Intuit or database trouble). Retry.
export class QboError extends Error {
  kind: QboErrorKind;
  constructor(kind: QboErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

export interface QboSettings {
  labour_item_id: string | null;
  half_day_item_id: string | null;
  full_day_item_id: string | null;
  tax_code_id: string | null;
}

export interface Connection {
  userId: string;
  realmId: string;
  accessToken: string;
  companyName: string | null;
  settings: QboSettings;
  // A token refresh in progress, shared by requests running in parallel.
  refreshing?: Promise<void>;
}

export const needsRefresh = (accessExpiresAt: string, nowMs: number) => !(Date.parse(accessExpiresAt) > nowMs + 30_000);

type RefreshResult = { ok: true; tokens: TokenSet } | { ok: false; revoked: boolean };

// `revoked` is true only when Intuit says the refresh token itself is no
// longer valid (expired, or access removed in QuickBooks).
export async function refreshTokens(cfg: QboConfig, refreshToken: string): Promise<RefreshResult> {
  let r: Response;
  try {
    r = await fetch((await oauthEndpoints(cfg)).token, {
      method: 'POST',
      headers: { Authorization: basicAuth(cfg), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, revoked: false };
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    logQboError('oauth:refresh', r, { error: errorCode(data?.error) });
    return { ok: false, revoked: r.status === 400 && data?.error === 'invalid_grant' };
  }
  const tokens = parseTokenResponse(data, Date.now());
  return tokens ? { ok: true, tokens } : { ok: false, revoked: false };
}

async function readRow(cfg: QboConfig, uid: string) {
  const r = await db(cfg, `qbo_connections?user_id=eq.${uid}&select=*`);
  if (!r.ok) throw new QboError('unavailable');
  return (await r.json())?.[0] ?? null;
}

async function markNeedsReconnect(cfg: QboConfig, uid: string) {
  await db(cfg, `qbo_connections?user_id=eq.${uid}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'needs_reconnect', updated_at: new Date().toISOString() } }).catch(() => null);
}

// deno-lint-ignore no-explicit-any
function toConnection(row: any, accessToken: string): Connection {
  return {
    userId: row.user_id,
    realmId: row.realm_id,
    accessToken,
    companyName: row.company_name ?? null,
    settings: {
      labour_item_id: row.labour_item_id ?? null,
      half_day_item_id: row.half_day_item_id ?? null,
      full_day_item_id: row.full_day_item_id ?? null,
      tax_code_id: row.tax_code_id ?? null,
    },
  };
}

// deno-lint-ignore no-explicit-any
async function refreshRow(cfg: QboConfig, key: CryptoKey, row: any): Promise<Connection> {
  const uid: string = row.user_id;
  let refreshToken: string;
  try { refreshToken = await decryptToken(key, row.refresh_token_enc, uid); } catch {
    await markNeedsReconnect(cfg, uid);
    throw new QboError('reconnect');
  }
  const res = await refreshTokens(cfg, refreshToken);
  if (!res.ok) {
    if (res.revoked) { await markNeedsReconnect(cfg, uid); throw new QboError('reconnect'); }
    throw new QboError('unavailable');
  }
  // Store only if nobody else refreshed in the meantime; if they did, use
  // what they stored. Either way the newest refresh token is the one kept.
  const saved = await db(cfg, `qbo_connections?user_id=eq.${uid}&access_expires_at=eq.${encodeURIComponent(row.access_expires_at)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      access_token_enc: await encryptToken(key, res.tokens.accessToken, uid),
      refresh_token_enc: await encryptToken(key, res.tokens.refreshToken, uid),
      access_expires_at: res.tokens.accessExpiresAt,
      refresh_expires_at: res.tokens.refreshExpiresAt,
      status: 'connected',
      updated_at: new Date().toISOString(),
    },
  });
  if (!saved.ok) throw new QboError('unavailable');
  if (((await saved.json()) ?? []).length === 0) {
    const latest = await readRow(cfg, uid);
    if (!latest) throw new QboError('not_connected');
    return toConnection(latest, await decryptToken(key, latest.access_token_enc, uid));
  }
  return toConnection(row, res.tokens.accessToken);
}

// Loads the account's connection with a usable access token, refreshing it
// when it has expired (or when `forceRefresh` is set).
export async function loadConnection(cfg: QboConfig, uid: string, forceRefresh = false): Promise<Connection> {
  const row = await readRow(cfg, uid);
  if (!row) throw new QboError('not_connected');
  // Connected under different keys (e.g. sandbox, and the server is now on
  // production): those tokens cannot be used.
  if (row.environment !== cfg.env || row.status === 'needs_reconnect') throw new QboError('reconnect');
  const key = await importTokenKey(cfg.tokenKey);
  if (!forceRefresh && !needsRefresh(row.access_expires_at, Date.now())) {
    try { return toConnection(row, await decryptToken(key, row.access_token_enc, uid)); } catch { /* unreadable: refresh instead */ }
  }
  return await refreshRow(cfg, key, row);
}

// One request to the QuickBooks API for this connection. `path` is relative
// to the company, e.g. "query?query=...". If QuickBooks rejects the access
// token it is refreshed once and the request retried.
export async function qboFetch(cfg: QboConfig, conn: Connection, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const send = (token: string) => {
    const u = new URL(`${INTUIT.api[cfg.env]}/v3/company/${conn.realmId}/${path}`);
    u.searchParams.set('minorversion', MINOR_VERSION);
    return fetch(u, {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  };
  let r: Response;
  const used = conn.accessToken;
  try { r = await send(used); } catch { throw new QboError('unavailable'); }
  if (r.status !== 401) {
    // Kind of request only (e.g. "api:invoice"); the query text is never logged.
    if (!r.ok) logQboError(`api:${path.split('?')[0]}`, r);
    return r;
  }
  logQboError(`api:${path.split('?')[0]}`, r, { retried: true });
  await r.body?.cancel();
  // Refresh once, even when several requests were rejected at the same time.
  if (conn.accessToken === used) {
    conn.refreshing ??= loadConnection(cfg, conn.userId, true)
      .then(fresh => { conn.accessToken = fresh.accessToken; })
      .finally(() => { conn.refreshing = undefined; });
  }
  if (conn.refreshing) await conn.refreshing;
  try { r = await send(conn.accessToken); } catch { throw new QboError('unavailable'); }
  if (r.status === 401) {
    logQboError(`api:${path.split('?')[0]}`, r);
    await r.body?.cancel();
    await markNeedsReconnect(cfg, conn.userId);
    throw new QboError('reconnect');
  }
  if (!r.ok) logQboError(`api:${path.split('?')[0]}`, r);
  return r;
}

// Runs a QuickBooks query and returns its QueryResponse object.
// deno-lint-ignore no-explicit-any
export async function qboQuery(cfg: QboConfig, conn: Connection, query: string): Promise<any> {
  const r = await qboFetch(cfg, conn, `query?query=${encodeURIComponent(query)}`);
  if (!r.ok) { await r.body?.cancel(); throw new QboError('unavailable'); }
  return (await r.json().catch(() => null))?.QueryResponse ?? {};
}

// ---- invoice setup choices --------------------------------------------------

export const validQboId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{1,20}$/.test(v);
const label = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 120) : '');

export interface ItemOption { id: string; name: string; type: string }
export interface TaxCodeOption { id: string; name: string; description: string; rate: number | null }

// Things that can go on an invoice line as work done: services (and
// non-inventory items, which some companies use for labour).
export function pickItems(queryResponse: unknown): ItemOption[] {
  // deno-lint-ignore no-explicit-any
  const items: any[] = Array.isArray((queryResponse as any)?.Item) ? (queryResponse as any).Item : [];
  return items
    .filter(i => validQboId(i?.Id) && i.Active !== false && (i.Type === 'Service' || i.Type === 'NonInventory') && label(i.FullyQualifiedName || i.Name))
    .map(i => ({ id: i.Id as string, name: label(i.FullyQualifiedName || i.Name), type: i.Type as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Sales tax codes with their total rate in percent (null when unknown).
export function pickTaxCodes(codesResponse: unknown, ratesResponse: unknown): TaxCodeOption[] {
  // deno-lint-ignore no-explicit-any
  const rates: any[] = Array.isArray((ratesResponse as any)?.TaxRate) ? (ratesResponse as any).TaxRate : [];
  const rateById = new Map<string, number>();
  for (const r of rates) {
    const n = Number(r?.RateValue);
    if (validQboId(r?.Id) && Number.isFinite(n)) rateById.set(r.Id, n);
  }
  // deno-lint-ignore no-explicit-any
  const codes: any[] = Array.isArray((codesResponse as any)?.TaxCode) ? (codesResponse as any).TaxCode : [];
  const out: TaxCodeOption[] = [];
  for (const c of codes) {
    if (!validQboId(c?.Id) || c.Active === false || !label(c.Name)) continue;
    const details = c?.SalesTaxRateList?.TaxRateDetail;
    // Codes with no sales rates are for purchases only.
    if (!Array.isArray(details) || details.length === 0) continue;
    let total: number | null = 0;
    for (const d of details) {
      const v = rateById.get(d?.TaxRateRef?.value);
      if (v === undefined) { total = null; break; }
      total += v;
    }
    out.push({ id: c.Id, name: label(c.Name), description: label(c.Description), rate: total === null ? null : Math.round(total * 1000) / 1000 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type SettingsCheck = { ok: true; settings: QboSettings } | { ok: false; error: string };

// Accepts only ids that exist in the lists just read from QuickBooks.
export function checkSettings(input: unknown, items: ItemOption[], taxCodes: TaxCodeOption[]): SettingsCheck {
  const s = (input ?? {}) as Record<string, unknown>;
  const itemIds = new Set(items.map(i => i.id));
  const optional = (v: unknown) => (v === null || v === undefined || v === '' ? null : v);
  const half = optional(s.half_day_item_id);
  const full = optional(s.full_day_item_id);
  if (!validQboId(s.labour_item_id) || !itemIds.has(s.labour_item_id)) return { ok: false, error: 'Choose the QuickBooks item to use for hourly labour.' };
  if (half !== null && (!validQboId(half) || !itemIds.has(half))) return { ok: false, error: 'The half-day item was not found in QuickBooks.' };
  if (full !== null && (!validQboId(full) || !itemIds.has(full))) return { ok: false, error: 'The full-day item was not found in QuickBooks.' };
  if (!validQboId(s.tax_code_id) || !taxCodes.some(t => t.id === s.tax_code_id)) return { ok: false, error: 'Choose the QuickBooks tax code to use on labour.' };
  return { ok: true, settings: { labour_item_id: s.labour_item_id, half_day_item_id: half as string | null, full_day_item_id: full as string | null, tax_code_id: s.tax_code_id } };
}

// ---- HTTP -------------------------------------------------------------------

export function corsHeaders(req: Request, allowedOrigins: string[]) {
  const origin = req.headers.get('origin') || '';
  const allow = allowedOrigins.length === 0 ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export const parseOrigins = (v: string | undefined) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
