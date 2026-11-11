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

export function authorizeUrl(cfg: Pick<QboConfig, 'clientId' | 'redirectUri'>, state: string) {
  const u = new URL(INTUIT.authorize);
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
  const r = await fetch(INTUIT.token, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!r.ok) return null;
  return parseTokenResponse(await r.json().catch(() => null), Date.now());
}

// Ends the connection at Intuit. Best effort: returns false on any failure.
export async function revokeToken(cfg: QboConfig, token: string) {
  try {
    const r = await fetch(INTUIT.revoke, {
      method: 'POST',
      headers: { Authorization: basicAuth(cfg), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
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
    if (!r.ok) return null;
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
