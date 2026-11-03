import { useEffect, useId, useState } from 'react';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { inp, lbl } from '../styles.js';
import { otherAccountsPending } from '../hooks/useLedger.js';

function maskEmail(e) {
  if (!e) return 'another account';
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}***@${d || ''}`;
}

function Shell({ children }) {
  const accent = useAccentColor();
  return (
    <main style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: '#f4f4f4', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -1 }}>
          Site<span style={{ color: accent }}>Ledger</span>
        </h1>
        <div style={{ color: '#777', fontSize: 14, marginTop: 6 }}>Time tracking for the job site</div>
      </div>
      {children}
    </main>
  );
}

const Msg = ({ kind, children }) => (
  <div role={kind === 'err' ? 'alert' : 'status'} style={kind === 'err'
    ? { background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: 10, padding: '12px 14px', color: '#a93226', fontSize: 13, lineHeight: 1.5 }
    : { background: '#e8f8ee', border: '1px solid #b7e4c7', borderRadius: 10, padding: '12px 14px', color: '#1e7a46', fontSize: 13, lineHeight: 1.5 }}>
    {children}
  </div>
);

export default function AuthScreen({ auth }) {
  const accent = useAccentColor();
  const id = useId();
  const [mode, setMode] = useState('signin'); // signup | signin | forgot
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState([]);

  useEffect(() => { otherAccountsPending(null).then(setOthers); }, []);

  const notice = auth.notice;

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    setErr(''); setMsg('');
    if (!email) { setErr('Please enter your email.'); return; }
    if (mode === 'forgot') {
      setBusy(true);
      const r = await auth.requestPasswordReset(email);
      setBusy(false);
      if (!r.ok) setErr(r.message); else setMsg('If that email has an account, a reset link is on its way. Open it on this device or any other.');
      return;
    }
    if (!pw) { setErr('Please enter your password.'); return; }
    if (mode === 'signup' && pw.length < 8) { setErr('Use at least 8 characters.'); return; }
    setBusy(true);
    const r = mode === 'signup' ? await auth.signUp(email, pw) : await auth.signIn(email, pw);
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    if (mode === 'signup' && !r.signedIn) { setMsg(r.message); setMode('signin'); setPw(''); }
  }

  function switchMode(m) { setMode(m); setErr(''); setMsg(''); }

  return (
    <Shell>
      {notice?.kind === 'expired' && (
        <div style={{ marginBottom: 16 }}><Msg kind="err">Your session ended{notice.email ? ` for ${notice.email}` : ''}. Sign in again to keep syncing. Anything saved on this device is kept and will upload after you sign in to the same account.</Msg></div>
      )}
      {notice?.kind === 'link-error' && (
        <div style={{ marginBottom: 16 }}><Msg kind="err">That link didn't work: {notice.message}. Request a new one below.</Msg></div>
      )}
      {others.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Msg kind="ok">
            This device has unsynced changes for {others.map(o => `${maskEmail(o.email)} (${o.pending})`).join(', ')}.
            They stay on this device and only upload when that account signs in.
          </Msg>
        </div>
      )}

      {mode !== 'forgot' ? (
        <div role="tablist" aria-label="Account" style={{ display: 'flex', background: '#eeeeee', borderRadius: 12, padding: 4, marginBottom: 24, border: '1px solid #e0e0e0' }}>
          {[['signin', 'Sign In'], ['signup', 'Create Account']].map(([m, l]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
              style={{ flex: 1, padding: '10px', borderRadius: 9, border: 'none', background: mode === m ? accent : 'transparent', color: mode === m ? '#fff' : '#555', fontWeight: mode === m ? 700 : 400, cursor: 'pointer', fontSize: 14 }}>
              {l}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', marginBottom: 6 }}>Reset Password</h2>
          <div style={{ color: '#666', fontSize: 14 }}>Enter your email and we'll send you a reset link.</div>
        </div>
      )}

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
        <div>
          <label htmlFor={`${id}-email`} style={lbl}>Email</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value.trim())} placeholder="you@example.com" style={inp} autoCapitalize="none" autoCorrect="off" />
        </div>
        {mode !== 'forgot' && (
          <div>
            <label htmlFor={`${id}-pw`} style={lbl}>Password</label>
            <input id={`${id}-pw`} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : ''} style={inp} />
          </div>
        )}
        {err && <Msg kind="err">{err}</Msg>}
        {msg && <Msg kind="ok">{msg}</Msg>}
        <button type="submit" disabled={busy}
          style={{ padding: '15px', borderRadius: 12, border: 'none', background: busy ? '#999' : accent, color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: busy ? 'not-allowed' : 'pointer', marginTop: 4 }}>
          {busy ? 'Please wait...' : mode === 'signup' ? 'Create Account' : mode === 'signin' ? 'Sign In' : 'Send Reset Link'}
        </button>
        {mode === 'signin' && (
          <button type="button" onClick={() => switchMode('forgot')} style={{ background: 'none', border: 'none', color: accent, fontSize: 13, cursor: 'pointer', padding: 4 }}>
            Forgot your password?
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => switchMode('signin')} style={{ background: 'none', border: 'none', color: accent, fontSize: 13, cursor: 'pointer', padding: 4 }}>
            Back to Sign In
          </button>
        )}
      </form>
      <p style={{ color: '#888', fontSize: 12, marginTop: 24, lineHeight: 1.5 }}>
        Signing in needs internet. Once signed in, the app keeps working offline on this device.
      </p>
    </Shell>
  );
}

export function NewPasswordScreen({ auth }) {
  const accent = useAccentColor();
  const id = useId();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setErr('');
    if (pw.length < 8) { setErr('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setErr('The passwords do not match.'); return; }
    setBusy(true);
    const r = await auth.setNewPassword(pw);
    setBusy(false);
    if (!r.ok) setErr(r.message);
  }

  return (
    <Shell>
      <h2 style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', marginBottom: 6 }}>Choose a new password</h2>
      <div style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>{auth.user?.email ? `For ${auth.user.email}.` : ''}</div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
        <div>
          <label htmlFor={`${id}-pw`} style={lbl}>New password</label>
          <input id={`${id}-pw`} type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} style={inp} />
        </div>
        <div>
          <label htmlFor={`${id}-pw2`} style={lbl}>Repeat new password</label>
          <input id={`${id}-pw2`} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} style={inp} />
        </div>
        {err && <Msg kind="err">{err}</Msg>}
        <button type="submit" disabled={busy} style={{ padding: 15, borderRadius: 12, border: 'none', background: busy ? '#999' : accent, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
        <button type="button" onClick={auth.cancelRecovery} style={{ background: 'none', border: 'none', color: accent, fontSize: 13, cursor: 'pointer', padding: 4 }}>Cancel</button>
      </form>
    </Shell>
  );
}
