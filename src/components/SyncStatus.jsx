import { useAccentColor } from '../lib/AccentColorContext.js';

// One line that always says where the user's work is:
//   stored on this phone / waiting to sync / syncing / needs attention / synced.
export function syncSummary({ authStatus, sync, pendingCount, problemCount, online }) {
  if (sync.serverOutdated) return { tone: 'warn', text: `Server update pending — ${pendingCount} change${pendingCount === 1 ? '' : 's'} held safely on this device.` };
  if (problemCount > 0) return { tone: 'error', text: `${problemCount} change${problemCount === 1 ? '' : 's'} could not sync. Tap to review.`, action: true };
  if (authStatus === 'offline' || sync.state === 'needs-sign-in' || sync.needsSignIn) {
    return pendingCount
      ? { tone: 'warn', text: `Offline — ${pendingCount} change${pendingCount === 1 ? '' : 's'} saved on this device, will sync when connected.`, action: true }
      : { tone: 'warn', text: 'Offline — new changes are saved on this device.' };
  }
  if (sync.state === 'offline' || !online) {
    return pendingCount
      ? { tone: 'warn', text: `Can't reach the server — ${pendingCount} change${pendingCount === 1 ? '' : 's'} saved on this device.`, action: true }
      : { tone: 'warn', text: "Can't reach the server — new changes are saved on this device." };
  }
  if (sync.state === 'syncing' && pendingCount) return { tone: 'info', text: `Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}…` };
  if (pendingCount) return { tone: 'info', text: `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync.`, action: true };
  return null;
}

export default function SyncStatus(props) {
  const accent = useAccentColor();
  const s = syncSummary(props);
  if (!s) return null;
  const bg = s.tone === 'error' ? '#c0392b' : s.tone === 'warn' ? '#8a5a14' : accent;
  const content = (
    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'DM Mono', monospace", letterSpacing: 0.3 }}>{s.text}</span>
  );
  return (
    <div role="status" aria-live="polite" style={{ background: bg, color: '#fff', textAlign: 'center' }}>
      {s.action && props.onOpen ? (
        <button type="button" onClick={props.onOpen} style={{ width: '100%', padding: '9px 16px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>{content}</button>
      ) : <div style={{ padding: '9px 16px' }}>{content}</div>}
    </div>
  );
}
