import { useCallback, useEffect, useRef, useState } from 'react';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { authClient, configured, storedSessionIdentity, forgetStoredSession } from '../lib/supabaseClient.js';
import { legacyAuthIdentity, LEGACY_AUTH_KEY } from '../lib/legacy.js';

// Auth states
//   loading      – reading the stored session
//   signed-in    – valid session
//   offline      – a stored session exists but could not be refreshed (no
//                  connection). Local data for that account stays usable and
//                  changes keep queuing; nothing syncs until it refreshes.
//   recovery     – arrived from a password-reset link; must set a new password
//   signed-out   – no session (notice explains why, e.g. it expired)
//   unconfigured – VITE_SUPABASE_* not set in this build

const isRetryable = e => !!e && (isAuthRetryableFetchError(e) || e.status === 0 || /fetch|network/i.test(e.message || ''));

function readUrlAuthState() {
  if (typeof window === 'undefined') return {};
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    recovery: h.get('type') === 'recovery',
    error: h.get('error_description') || (h.get('error') ? h.get('error') : null),
  };
}

function clearUrlHash() {
  try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ }
}

const toUser = u => (u ? { uid: u.id, email: u.email || null } : null);

export function useAuth() {
  const urlState = useRef(readUrlAuthState());
  // Open on-device data immediately from the stored session (no network).
  // supabase-js may spend ~30 s retrying a token refresh with no signal; the
  // app must not wait for that in a basement.
  const [state, setState] = useState(() => {
    const notice = urlState.current.error ? { kind: 'link-error', message: urlState.current.error } : null;
    if (!configured) return { status: 'unconfigured', user: null, notice };
    if (urlState.current.recovery) return { status: 'loading', user: null, notice };
    const stored = storedSessionIdentity() || (() => { const l = legacyAuthIdentity(localStorage); return l ? { uid: l.uid, email: l.email } : null; })();
    return stored ? { status: 'offline', user: stored, notice } : { status: 'loading', user: null, notice };
  });
  const signingOut = useRef(false);
  const userRef = useRef(null);
  userRef.current = state.user;

  // Moves a session stored by the pre-2026-11 app into supabase-js storage.
  const migrateLegacySession = useCallback(async () => {
    const legacy = legacyAuthIdentity(localStorage);
    if (!legacy) return { legacy: null };
    if (storedSessionIdentity()) { localStorage.removeItem(LEGACY_AUTH_KEY); return { legacy: null }; }
    if (!legacy.refresh_token) { localStorage.removeItem(LEGACY_AUTH_KEY); return { legacy: null }; }
    const { error } = await authClient.auth.setSession({ access_token: legacy.access_token, refresh_token: legacy.refresh_token });
    if (!error) { localStorage.removeItem(LEGACY_AUTH_KEY); return { legacy: null }; }
    if (isRetryable(error)) return { legacy }; // try again when online
    localStorage.removeItem(LEGACY_AUTH_KEY);
    return { legacy: null, expired: legacy };
  }, []);

  const resolveSession = useCallback(async () => {
    const { legacy, expired } = await migrateLegacySession();
    const { data, error } = await authClient.auth.getSession();
    if (data?.session) {
      setState(s => ({
        status: urlState.current.recovery ? 'recovery' : 'signed-in',
        user: toUser(data.session.user),
        notice: s.notice?.kind === 'link-error' ? s.notice : null,
      }));
      return;
    }
    const stored = storedSessionIdentity() || (legacy ? { uid: legacy.uid, email: legacy.email } : null);
    if (stored && (!error || isRetryable(error))) {
      setState(s => ({ status: 'offline', user: stored, notice: s.notice }));
      return;
    }
    const lost = expired || userRef.current;
    setState(s => ({
      status: 'signed-out',
      user: null,
      notice: s.notice?.kind === 'link-error' ? s.notice : lost ? { kind: 'expired', email: lost.email } : null,
    }));
  }, [migrateLegacySession]);

  useEffect(() => {
    if (!configured) return undefined;
    let alive = true;
    const { data: sub } = authClient.auth.onAuthStateChange((event, session) => {
      // Deferred per supabase-js guidance (no awaits inside the callback).
      setTimeout(() => {
        if (!alive) return;
        if (event === 'PASSWORD_RECOVERY') {
          setState({ status: 'recovery', user: toUser(session?.user), notice: null });
        } else if (event === 'SIGNED_OUT') {
          const was = userRef.current;
          setState({
            status: 'signed-out', user: null,
            notice: was && !signingOut.current ? { kind: 'expired', email: was.email } : null,
          });
        } else if (session && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
          setState(s => (s.status === 'recovery'
            ? { ...s, user: toUser(session.user) }
            : { status: 'signed-in', user: toUser(session.user), notice: null }));
        }
      }, 0);
    });
    resolveSession().catch(() => { if (alive) setState(s => ({ ...s, status: storedSessionIdentity() ? 'offline' : 'signed-out', user: storedSessionIdentity() })); });
    return () => { alive = false; sub?.subscription?.unsubscribe(); };
  }, [resolveSession]);

  // While offline, retry when connectivity may be back.
  useEffect(() => {
    if (state.status !== 'offline') return undefined;
    const retry = () => { resolveSession().catch(() => {}); };
    window.addEventListener('online', retry);
    const id = setInterval(retry, 30000);
    return () => { window.removeEventListener('online', retry); clearInterval(id); };
  }, [state.status, resolveSession]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: isRetryable(error) ? 'No connection. Signing in needs internet.' : error.message };
    return { ok: true, user: toUser(data.user) };
  }, []);

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await authClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (error) return { ok: false, message: isRetryable(error) ? 'No connection. Creating an account needs internet.' : error.message };
    if (data.session) return { ok: true, signedIn: true };
    // Confirmation required. Supabase returns a user with no identities when
    // the address is already registered (without revealing that directly).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: true, signedIn: false, message: 'If this email is new, check your inbox to confirm it. If you already have an account, sign in instead.' };
    }
    return { ok: true, signedIn: false, message: 'Check your email and open the confirmation link, then sign in.' };
  }, []);

  const requestPasswordReset = useCallback(async email => {
    const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) return { ok: false, message: isRetryable(error) ? 'No connection. Try again when you have internet.' : error.message };
    return { ok: true };
  }, []);

  const setNewPassword = useCallback(async password => {
    const { error } = await authClient.auth.updateUser({ password });
    if (error) return { ok: false, message: isRetryable(error) ? 'No connection. Try again when you have internet.' : error.message };
    urlState.current.recovery = false;
    clearUrlHash();
    const { data } = await authClient.auth.getSession();
    setState({ status: 'signed-in', user: toUser(data?.session?.user), notice: { kind: 'password-updated' } });
    return { ok: true };
  }, []);

  const cancelRecovery = useCallback(async () => {
    urlState.current.recovery = false;
    clearUrlHash();
    signingOut.current = true;
    await authClient.auth.signOut({ scope: 'local' }).catch(() => {});
    forgetStoredSession();
    signingOut.current = false;
    setState({ status: 'signed-out', user: null, notice: null });
  }, []);

  // Signs out of this device. Local data handling is the caller's job (see
  // useLedger.prepareSignOut); this only ends the session.
  const signOut = useCallback(async () => {
    signingOut.current = true;
    const { error } = await authClient.auth.signOut({ scope: 'local' }).catch(e => ({ error: e }));
    // Offline, supabase-js cannot reach the server and keeps the session;
    // remove it locally so this device is signed out regardless.
    if (error) forgetStoredSession();
    try { localStorage.removeItem(LEGACY_AUTH_KEY); } catch { /* ignore */ }
    setState({ status: 'signed-out', user: null, notice: null });
  }, []);

  const dismissNotice = useCallback(() => setState(s => ({ ...s, notice: null })), []);

  return { ...state, signIn, signUp, requestPasswordReset, setNewPassword, cancelRecovery, signOut, dismissNotice };
}
