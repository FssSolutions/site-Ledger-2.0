import { useEffect, useState } from 'react';
import { qboInvoiceMode } from '../lib/qboApi.js';

// Whether this account creates invoices in QuickBooks, so screens can word
// themselves accordingly:
//   checking  – not known yet (treated like "off" for wording)
//   off       – QuickBooks is not connected: no QuickBooks wording at all
//   ready     – connected and set up: invoices are created in QuickBooks
//   setup     – connected, invoice setup not finished
//   reconnect – connected, but access needs renewing
export function useQboMode(ledger) {
  const { qboStatus, ready, online } = ledger;
  const [mode, setMode] = useState('checking');
  useEffect(() => {
    if (!ready || !qboStatus) return undefined;
    let alive = true;
    // A failed check (offline, old server) keeps the last known answer, or
    // "off" when there is none.
    qboStatus().then(
      r => { if (alive) setMode(m => (r?.ok ? qboInvoiceMode(r.data) : m === 'checking' ? 'off' : m)); },
      () => { if (alive) setMode(m => (m === 'checking' ? 'off' : m)); },
    );
    return () => { alive = false; };
  }, [ready, online, qboStatus]);
  return mode;
}

export const usesQuickBooks = mode => mode === 'ready' || mode === 'setup' || mode === 'reconnect';
