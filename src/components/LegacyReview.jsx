import { useState } from 'react';
import { describeLegacyOp, adoptLegacyQueue, setBackupStatus } from '../lib/legacy.js';
import { getLocalDb } from '../hooks/useLedger.js';
import { downloadText } from '../lib/csv.js';
import { Modal, ModalHeader } from './Modal.jsx';

// Shown only to the account whose login token was stored with the old data.
export default function LegacyReview({ legacy, uid, ledger, toast }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(legacy.status !== 'needs-review');
  if (done || legacy.ownerUid !== uid || !legacy.queue?.length) return null;

  async function adopt() {
    setBusy(true);
    const store = ledger.getStore();
    if (!store) { setBusy(false); return; }
    const results = await adoptLegacyQueue(store, legacy.queue, { companyId: ledger.view.companyRow?.id });
    const db = await getLocalDb();
    await setBackupStatus(db, legacy.key, 'imported', { importedAt: new Date().toISOString(), results: results.map(r => ({ ok: r.ok, reason: r.reason || null })) });
    const skipped = results.filter(r => !r.ok).length;
    toast(skipped ? `${results.length - skipped} changes queued; ${skipped} could not be recovered (kept in the backup).` : 'Older changes queued for sync.', skipped ? 'info' : 'success');
    setBusy(false); setOpen(false); setDone(true);
  }

  async function keep() {
    const db = await getLocalDb();
    await setBackupStatus(db, legacy.key, 'kept');
    setOpen(false); setDone(true);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ width: '100%', padding: '10px 16px', background: '#FEF5E7', border: 'none', borderBottom: '1px solid #f0c070', color: '#7a4a00', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {legacy.queue.length} unsynced change{legacy.queue.length === 1 ? '' : 's'} from the previous app version need review
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <ModalHeader title="Recovered changes" subtitle="Saved by the previous version of SiteLedger on this device" onClose={() => setOpen(false)} />
          <p style={{ fontSize: 13, color: '#444', lineHeight: 1.5, marginBottom: 12 }}>
            The old version kept these in shared browser storage without recording which account made them. They were stored while {legacy.ownerEmail || 'this account'} was signed in. Only add them if they are yours. Edits to existing records will be checked against the server and shown to you if they differ.
          </p>
          <ul style={{ fontSize: 13, color: '#333', margin: '0 0 16px 18px' }}>
            {legacy.queue.map((op, i) => <li key={i} style={{ marginBottom: 4 }}>{describeLegacyOp(op)}</li>)}
          </ul>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" disabled={busy} onClick={adopt} style={{ padding: 13, borderRadius: 10, border: 'none', background: '#222', color: '#fff', fontWeight: 700 }}>{busy ? 'Adding…' : 'These are mine — add to my pending changes'}</button>
            <button type="button" onClick={() => downloadText('siteledger-recovered-changes.json', JSON.stringify(legacy.queue, null, 2), 'application/json')} style={{ padding: 13, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontWeight: 700 }}>Download a copy</button>
            <button type="button" onClick={keep} style={{ padding: 13, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontWeight: 700 }}>Not now (keep the backup on this device)</button>
          </div>
        </Modal>
      )}
    </>
  );
}
