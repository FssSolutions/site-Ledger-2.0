import { useAccentColor } from '../lib/AccentColorContext.js';

export default function OfflineBanner({ online, syncing, queueCount }) {
  const accent = useAccentColor();
  if (online && !syncing) return null;

  return (
    <div style={{
      padding: '8px 16px', fontSize: 12, fontWeight: 600, textAlign: 'center',
      fontFamily: "'DM Mono', monospace", letterSpacing: 0.5,
      background: syncing ? accent : '#c0392b', color: '#fff',
    }}>
      {syncing
        ? `Syncing ${queueCount} pending change${queueCount !== 1 ? 's' : ''}...`
        : 'You are offline — changes will sync when you reconnect'}
    </div>
  );
}
