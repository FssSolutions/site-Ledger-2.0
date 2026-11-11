import { useCallback, useEffect, useRef, useState } from 'react';
import { card } from '../styles.js';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { startQboConnect, disconnectQbo } from '../lib/qboApi.js';

const heading = { color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 };
const note = { color: '#777', fontSize: 12, lineHeight: 1.5 };

// Connect / disconnect QuickBooks Online. Shows only a status from the
// server; tokens never reach the browser. Renders nothing when the server
// does not have the QuickBooks update yet.
export default function QuickBooksCard({ ledger, uid, online, toast }) {
  const accent = useAccentColor();
  const { qboStatus, ready } = ledger;
  const [st, setSt] = useState({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const r = await qboStatus();
    if (!alive.current) return;
    if (r.ok) setSt({ phase: 'ready', data: r.data || { connected: false } });
    else if (r.unavailable) setSt({ phase: 'hidden' });
    else if (r.offline) setSt(p => (p.phase === 'ready' ? p : { phase: 'offline' }));
    else setSt(p => (p.phase === 'ready' ? p : { phase: 'error' }));
  }, [qboStatus]);

  // Load when the account is ready, when the connection comes back, and when
  // the app returns to the foreground (e.g. after signing in at Intuit in
  // another window).
  useEffect(() => {
    if (!ready) return undefined;
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, online, load]);

  async function connect() {
    setBusy(true);
    const r = await startQboConnect(uid);
    if (!r.ok) { setBusy(false); toast?.(r.error); return; }
    window.location.assign(r.data.url); // leaves the app; Intuit sends the browser back
  }

  async function disconnect() {
    if (!window.confirm('Disconnect QuickBooks? SiteLedger will no longer be able to reach your QuickBooks company. Nothing in QuickBooks is deleted, and you can connect again at any time.')) return;
    setBusy(true);
    const r = await disconnectQbo(uid);
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) { toast?.(r.error); return; }
    toast?.('QuickBooks disconnected.', 'success');
    setSt({ phase: 'ready', data: { connected: false } });
    load();
  }

  if (st.phase === 'hidden') return null;

  const d = st.phase === 'ready' ? st.data : null;
  const needsReconnect = d?.connected && d.status === 'needs_reconnect';
  const primary = { width: '100%', padding: 13, borderRadius: 12, border: 'none', background: accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 };
  const secondary = { padding: '9px 14px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', color: '#555', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 };

  return (
    <section aria-label="QuickBooks" style={{ ...card, padding: '20px 18px', marginTop: 12 }}>
      <div style={heading}>QuickBooks</div>

      {st.phase === 'loading' && <div style={note}>Checking QuickBooks connection…</div>}
      {st.phase === 'offline' && <div style={note}>QuickBooks connection needs internet.</div>}
      {st.phase === 'error' && (
        <div style={note}>
          Could not check the QuickBooks connection.{' '}
          <button type="button" onClick={load} style={{ color: accent, background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer', padding: 0 }}>Try again</button>
        </div>
      )}

      {d && !d.connected && (
        <>
          <div style={{ ...note, marginBottom: 14 }}>
            Connect your QuickBooks Online company so SiteLedger can create invoices there for you. Connecting on its own does not change anything in QuickBooks.
          </div>
          <button type="button" onClick={connect} disabled={busy} style={primary}>{busy ? 'Opening QuickBooks…' : 'Connect QuickBooks'}</button>
          <div style={{ ...note, fontSize: 11, marginTop: 8, textAlign: 'center' }}>You will sign in on Intuit&rsquo;s website, then come back here.</div>
        </>
      )}

      {d?.connected && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: needsReconnect ? '#d98a1c' : '#3BB273', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>
                {needsReconnect ? 'QuickBooks needs to be reconnected' : `Connected to ${d.company_name || 'QuickBooks'}`}
              </div>
              {needsReconnect && d.company_name && <div style={note}>{d.company_name}</div>}
              {d.environment === 'sandbox' && <div style={{ ...note, color: '#9a4a10' }}>Test company (sandbox), not your real books</div>}
            </div>
          </div>
          {needsReconnect && (
            <>
              <div style={{ ...note, marginBottom: 12 }}>QuickBooks access expired or was removed. Reconnect to keep using it.</div>
              <button type="button" onClick={connect} disabled={busy} style={{ ...primary, marginBottom: 10 }}>{busy ? 'Opening QuickBooks…' : 'Reconnect QuickBooks'}</button>
            </>
          )}
          <button type="button" onClick={disconnect} disabled={busy} style={secondary}>Disconnect</button>
        </>
      )}
    </section>
  );
}
