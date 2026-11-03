// Single Supabase auth client for the whole app, plus per-account data
// clients. All data requests go through a client bound to ONE account id:
// before every request it reads the current session and refuses to proceed if
// the signed-in account is no longer the one the client was created for. An
// account's queued changes can therefore never be sent with another
// account's token, even if the user switches accounts mid-sync.

import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// The anon key is public by design; access is controlled by RLS.
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const AUTH_STORAGE_KEY = 'sl-auth';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const authClient = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Implicit flow so a password-reset link works even when opened on a
        // different device/browser than the one that requested it.
        flowType: 'implicit',
        storageKey: AUTH_STORAGE_KEY,
      },
    })
  : null;

export class AccountChangedError extends Error {
  constructor() { super('The signed-in account changed.'); this.code = 'ACCOUNT_CHANGED'; }
}

const SESSION_WAIT_MS = 8000;

export async function accessTokenFor(uid) {
  // getSession() can block for ~30 s retrying a refresh when offline; give up
  // sooner and let the caller treat it as "no connection".
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error('Timed out waiting for sign-in session (offline?)'); e.status = 0; reject(e); }, SESSION_WAIT_MS); });
  const { data, error } = await Promise.race([authClient.auth.getSession(), timeout]).finally(() => clearTimeout(timer));
  const session = data?.session;
  if (!session) {
    const e = new Error(error?.message || 'Not signed in (offline or session expired).');
    e.status = 0;
    throw e;
  }
  if (session.user?.id !== uid) throw new AccountChangedError();
  return session.access_token;
}

export function createAccountClient(uid) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: () => accessTokenFor(uid),
  });
}

// Reads the stored session without network access, so the app can keep
// working offline after the access token has expired.
export function storedSessionIdentity(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const user = s?.user || s?.currentSession?.user;
    if (!user?.id || !s.refresh_token) return null;
    return { uid: user.id, email: user.email || null };
  } catch { return null; }
}

export function forgetStoredSession(storage = globalThis.localStorage) {
  try { storage.removeItem(AUTH_STORAGE_KEY); storage.removeItem(`${AUTH_STORAGE_KEY}-user`); storage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`); } catch { /* ignore */ }
}
