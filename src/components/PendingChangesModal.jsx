import { useState } from 'react';
import { Modal, ModalHeader, ConfirmDialog } from './Modal.jsx';
import { fmtCAD } from '../lib/utils.js';

const TABLE_LABEL = { sessions: 'Time entry', jobs: 'Job', employees: 'Crew member', customers: 'Customer', mileage: 'Trip', expenses: 'Expense', company_profiles: 'Company profile' };
const KIND_LABEL = { insert: 'New', update: 'Edit', delete: 'Delete' };

function describe(op, view) {
  const row = op.row || op.fields || {};
  const job = view.jobs.find(j => j.id === (row.job_id || view.sessions.find(s => s.id === op.recordId)?.job_id));
  const bits = [];
  if (row.name) bits.push(row.name);
  if (row.description) bits.push(row.description);
  if (row.start_time) bits.push(new Date(row.start_time).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }));
  if (row.date) bits.push(row.date);
  if (row.amount != null) bits.push(fmtCAD(row.amount));
  if (job && op.table !== 'jobs') bits.push(job.name);
  return `${KIND_LABEL[op.kind]} ${TABLE_LABEL[op.table]?.toLowerCase() || op.table}${bits.length ? ' — ' + bits.join(' · ') : ''}`;
}

function diffRows(op) {
  if (!op.server) return [];
  const mine = op.fields || op.row || {};
  return Object.keys(mine).filter(k => String(mine[k] ?? '') !== String(op.server[k] ?? '')).map(k => ({ field: k, mine: mine[k], theirs: op.server[k] }));
}

export default function PendingChangesModal({ ops, view, onRetry, onDiscard, onResolve, onSyncNow, syncState, onClose }) {
  const [confirm, setConfirm] = useState(null);
  const problems = ops.filter(o => o.status !== 'pending');
  const waiting = ops.filter(o => o.status === 'pending');

  if (confirm) return <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />;

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Changes on this device" subtitle={`${ops.length} not yet confirmed by the server`} onClose={onClose} />
      <button type="button" onClick={onSyncNow} disabled={syncState === 'syncing'}
        style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontWeight: 700, marginBottom: 16, cursor: 'pointer' }}>
        {syncState === 'syncing' ? 'Syncing…' : 'Try to sync now'}
      </button>

      {problems.length > 0 && <h3 style={{ fontSize: 13, color: '#c0392b', margin: '0 0 8px' }}>Needs your attention</h3>}
      {problems.map(op => (
        <div key={op.opId} style={{ border: '1px solid #f5c6c6', background: '#fff7f7', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{describe(op, view)}</div>
          <div style={{ fontSize: 12, color: '#a33', marginTop: 4 }}>{op.lastError?.message || (op.status === 'conflict' ? 'Changed on another device.' : 'The server refused this change.')}</div>
          {op.status === 'conflict' && diffRows(op).length > 0 && (
            <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Field</th><th style={{ textAlign: 'left' }}>This device</th><th style={{ textAlign: 'left' }}>Server</th></tr></thead>
              <tbody>{diffRows(op).map(d => <tr key={d.field}><td>{d.field}</td><td>{String(d.mine ?? '—')}</td><td>{String(d.theirs ?? '—')}</td></tr>)}</tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {op.status === 'conflict' ? (
              <>
                <button type="button" onClick={() => onResolve(op.opId, 'mine')} style={btn}>Keep this device's version</button>
                <button type="button" onClick={() => onResolve(op.opId, 'theirs')} style={btn}>Keep the server's version</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onRetry(op.opId)} style={btn}>Retry</button>
                <button type="button" onClick={() => setConfirm({
                  title: 'Discard this change?',
                  message: 'This change has not reached the server. Discarding it removes it from this device permanently.',
                  actions: [
                    { label: 'Discard change', danger: true, onClick: () => { onDiscard(op.opId); setConfirm(null); } },
                    { label: 'Keep it', autoFocus: true, onClick: () => setConfirm(null) },
                  ],
                })} style={{ ...btn, color: '#c0392b' }}>Discard…</button>
              </>
            )}
          </div>
        </div>
      ))}

      {waiting.length > 0 && <h3 style={{ fontSize: 13, color: '#555', margin: '12px 0 8px' }}>Waiting to sync (saved on this device)</h3>}
      {waiting.map(op => (
        <div key={op.opId} style={{ fontSize: 13, color: '#444', padding: '8px 0', borderBottom: '1px solid #eee' }}>
          {describe(op, view)}
          {op.lastError && <div style={{ fontSize: 11, color: '#8a5a14' }}>Last attempt: {op.lastError.message}</div>}
        </div>
      ))}
      {ops.length === 0 && <div style={{ color: '#3BB273', fontSize: 14 }}>Everything on this device is synced.</div>}
    </Modal>
  );
}

const btn = { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
