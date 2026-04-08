import { useState } from 'react';
import { api } from '../lib/api.js';
import { saveAuth } from '../lib/auth.js';
import { inp, lbl } from '../styles.js';

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !pw) { setErr('Please enter your email and password.'); return; }
    if (pw.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setErr(''); setMsg(''); setBusy(true);
    if (mode === 'signup') {
      const d = await api.signUp(email, pw);
      if (d.error) { setErr(d.error.message); }
      else {
        setMsg('Account created! Signing you in...');
        const s = await api.signIn(email, pw);
        if (s.access_token) { saveAuth(s); onAuth(s); }
        else { setErr(s.error?.message || 'Please sign in manually.'); setMode('signin'); }
      }
    } else {
      const d = await api.signIn(email, pw);
      if (d.access_token) { saveAuth(d); onAuth(d); }
      else setErr(d.error?.message || 'Incorrect email or password.');
    }
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: '#f4f4f4', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 36, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -1 }}>
          Site<span style={{ color: '#E8651A' }}>Ledger</span>
        </div>
        <div style={{ color: '#999', fontSize: 14, marginTop: 6 }}>Time tracking for the job site</div>
      </div>
      <div style={{ display: 'flex', background: '#eeeeee', borderRadius: 12, padding: 4, marginBottom: 24, border: '1px solid #e0e0e0' }}>
        {[['signup', 'Create Account'], ['signin', 'Sign In']].map(([m, l]) => (
          <button key={m} onClick={() => { setMode(m); setErr(''); setMsg(''); }}
            style={{ flex: 1, padding: '10px', borderRadius: 9, border: 'none', background: mode === m ? '#E8651A' : 'transparent', color: mode === m ? '#fff' : '#888', fontWeight: mode === m ? 700 : 400, cursor: 'pointer', fontSize: 14 }}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={lbl}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value.trim())} placeholder="you@example.com" style={inp} autoCapitalize="none" autoCorrect="off" />
        </div>
        <div>
          <label style={lbl}>Password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Min. 6 characters" style={inp} onKeyDown={e => e.key === 'Enter' && submit()} />
        </div>
        {err && <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: 10, padding: '12px 14px', color: '#c0392b', fontSize: 13, lineHeight: 1.5 }}>{err}</div>}
        {msg && <div style={{ background: '#e8f8ee', border: '1px solid #b7e4c7', borderRadius: 10, padding: '12px 14px', color: '#27ae60', fontSize: 13 }}>{msg}</div>}
        <button onClick={submit} disabled={busy}
          style={{ padding: '15px', borderRadius: 12, border: 'none', background: busy ? '#ccc' : '#E8651A', color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: busy ? 'not-allowed' : 'pointer', marginTop: 4 }}>
          {busy ? 'Please wait...' : (mode === 'signup' ? 'Create Account' : 'Sign In')}
        </button>
      </div>
    </div>
  );
}
