import { useEffect, useState } from 'react';

// A new app version is installed in the background and waits; it is applied
// only when the user chooses. Pending work lives in IndexedDB, so reloading
// never loses it.
export default function UpdateBanner() {
  const [waiting, setWaiting] = useState(null);
  useEffect(() => {
    const onUpdate = e => setWaiting(e.detail);
    window.addEventListener('sl-update-ready', onUpdate);
    return () => window.removeEventListener('sl-update-ready', onUpdate);
  }, []);
  if (!waiting) return null;
  return (
    <div role="status" style={{ background: '#1B4F72', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 16px', fontSize: 13 }}>
      <span>A new version of SiteLedger is ready.</span>
      <button type="button" onClick={() => { waiting.postMessage({ type: 'SKIP_WAITING' }); }}
        style={{ background: '#fff', color: '#1B4F72', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>Update</button>
    </div>
  );
}
