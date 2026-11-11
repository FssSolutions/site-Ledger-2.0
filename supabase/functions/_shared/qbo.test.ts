import { describe, it, expect } from 'vitest';
import {
  readConfig, b64encode, b64decode, importTokenKey, encryptToken, decryptToken, newState, hashState,
  authorizeUrl, appReturnUrl, parseTokenResponse, validRealmId, validAuthCode, validState, corsHeaders, parseOrigins,
} from './qbo.ts';

const KEY = b64encode(new Uint8Array(32).map((_, i) => i + 1));
const ENV: Record<string, string> = {
  QBO_CLIENT_ID: 'client-id',
  QBO_CLIENT_SECRET: 'client-secret',
  QBO_ENV: 'sandbox',
  QBO_REDIRECT_URI: 'https://proj.supabase.co/functions/v1/qbo-callback',
  QBO_TOKEN_KEY: KEY,
  APP_URL: 'https://app.example/',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};
const config = (over: Record<string, string | undefined> = {}) => readConfig(n => ({ ...ENV, ...over })[n]);

describe('qbo configuration', () => {
  it('accepts a complete configuration and trims the app URL', () => {
    const r = config();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cfg.appUrl).toBe('https://app.example');
      expect(r.cfg.env).toBe('sandbox');
    }
  });

  it('reports missing secrets by name only', () => {
    const r = config({ QBO_CLIENT_SECRET: undefined, APP_URL: ' ' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toContain('QBO_CLIENT_SECRET is not set');
      expect(r.problems).toContain('APP_URL is not set');
      expect(r.problems.join(' ')).not.toContain('client-secret');
    }
  });

  it('rejects a bad environment, redirect URI or token key', () => {
    expect(config({ QBO_ENV: 'prod' }).ok).toBe(false);
    expect(config({ QBO_REDIRECT_URI: 'http://proj.supabase.co/functions/v1/qbo-callback' }).ok).toBe(false);
    expect(config({ QBO_TOKEN_KEY: b64encode(new Uint8Array(16)) }).ok).toBe(false);
    expect(config({ QBO_TOKEN_KEY: 'not base64!!' }).ok).toBe(false);
    expect(config({ APP_URL: 'app.example' }).ok).toBe(false);
  });
});

describe('qbo token encryption', () => {
  it('round-trips and never stores the plaintext', async () => {
    const key = await importTokenKey(KEY);
    const stored = await encryptToken(key, 'refresh-token-value', 'user-a');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('refresh-token-value');
    expect(await decryptToken(key, stored, 'user-a')).toBe('refresh-token-value');
  });

  it('uses a fresh nonce each time', async () => {
    const key = await importTokenKey(KEY);
    expect(await encryptToken(key, 'same', 'user-a')).not.toBe(await encryptToken(key, 'same', 'user-a'));
  });

  it('does not decrypt for another account, another key, or after tampering', async () => {
    const key = await importTokenKey(KEY);
    const other = await importTokenKey(b64encode(new Uint8Array(32).fill(9)));
    const stored = await encryptToken(key, 'secret', 'user-a');
    await expect(decryptToken(key, stored, 'user-b')).rejects.toThrow();
    await expect(decryptToken(other, stored, 'user-a')).rejects.toThrow();
    const [v, iv, ct] = stored.split(':');
    const bytes = b64decode(ct);
    bytes[0] ^= 1;
    await expect(decryptToken(key, `${v}:${iv}:${b64encode(bytes)}`, 'user-a')).rejects.toThrow();
    await expect(decryptToken(key, 'plain-text-token', 'user-a')).rejects.toThrow();
  });

  it('refuses a key of the wrong length', async () => {
    await expect(importTokenKey(b64encode(new Uint8Array(31)))).rejects.toThrow();
  });
});

describe('qbo sign-in state and URLs', () => {
  it('creates unguessable, URL-safe states and stable hashes', async () => {
    const a = newState();
    const b = newState();
    expect(a).not.toBe(b);
    expect(validState(a)).toBe(true);
    expect(await hashState(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashState(a)).toBe(await hashState(a));
    expect(await hashState(a)).not.toBe(await hashState(b));
  });

  it('builds the Intuit sign-in URL', () => {
    const u = new URL(authorizeUrl({ clientId: 'client-id', redirectUri: ENV.QBO_REDIRECT_URI }, 'state-123'));
    expect(u.origin + u.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(u.searchParams.get('client_id')).toBe('client-id');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(u.searchParams.get('redirect_uri')).toBe(ENV.QBO_REDIRECT_URI);
    expect(u.searchParams.get('state')).toBe('state-123');
    expect(u.toString()).not.toContain('client-secret');
  });

  it('sends the browser back to the app with only a result code', () => {
    expect(appReturnUrl('https://app.example', 'connected')).toBe('https://app.example/?qbo=connected');
    expect(appReturnUrl('https://app.example/', 'error', 'invalid_state')).toBe('https://app.example/?qbo=error&reason=invalid_state');
  });

  it('validates what Intuit sends back', () => {
    expect(validRealmId('4620816365000000001')).toBe(true);
    expect(validRealmId('12; drop')).toBe(false);
    expect(validRealmId(null)).toBe(false);
    expect(validAuthCode('AB11abc')).toBe(true);
    expect(validAuthCode('')).toBe(false);
    expect(validAuthCode('x'.repeat(600))).toBe(false);
    expect(validState('short')).toBe(false);
    expect(validState('a'.repeat(43) + '&x=1')).toBe(false);
    expect(validState(null)).toBe(false);
  });
});

describe('qbo token response', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');

  it('reads tokens and expiry times', () => {
    const t = parseTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8640000 }, now);
    expect(t).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      accessExpiresAt: '2026-11-11T12:59:00.000Z', // one minute early
      refreshExpiresAt: '2027-02-19T12:00:00.000Z',
    });
  });

  it('treats a missing expiry as already expired and a missing refresh expiry as unknown', () => {
    const t = parseTokenResponse({ access_token: 'a', refresh_token: 'r' }, now);
    expect(t?.accessExpiresAt).toBe('2026-11-11T12:00:00.000Z');
    expect(t?.refreshExpiresAt).toBeNull();
  });

  it('rejects incomplete responses', () => {
    expect(parseTokenResponse(null, now)).toBeNull();
    expect(parseTokenResponse({ access_token: 'a' }, now)).toBeNull();
    expect(parseTokenResponse({ access_token: '', refresh_token: 'r' }, now)).toBeNull();
    expect(parseTokenResponse({ error: 'invalid_grant' }, now)).toBeNull();
  });
});

describe('qbo CORS', () => {
  const req = (origin: string) => new Request('https://x.example', { headers: { origin } });

  it('echoes only allowed origins', () => {
    const allowed = parseOrigins('https://app.example, https://other.example');
    expect(corsHeaders(req('https://other.example'), allowed)['Access-Control-Allow-Origin']).toBe('https://other.example');
    expect(corsHeaders(req('https://evil.example'), allowed)['Access-Control-Allow-Origin']).toBe('https://app.example');
    expect(corsHeaders(req('https://evil.example'), parseOrigins(undefined))['Access-Control-Allow-Origin']).toBe('*');
  });
});
