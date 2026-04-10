import { useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl, card } from '../styles.js';
import generateInvoice from '../lib/generateInvoice.js';

export default function InvoiceModal({ sessions, jobs, employees, dateRange, company, onClose }) {
  const [clientName, setClientName] = useState('');
  const [invoiceNum, setInvoiceNum] = useState('INV-001');
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [done, setDone] = useState(false);

  // Jobs that have sessions in the date range
  const [rs, re] = dateRange;
  const activeSessions = sessions.filter(s => {
    if (!s.end_time) return false;
    const t = new Date(s.start_time);
    return t >= rs && t <= re;
  });
  const activeJobIds = [...new Set(activeSessions.map(s => s.job_id))];
  const activeJobs = jobs.filter(j => activeJobIds.includes(j.id));

  function toggleJob(id) {
    setSelectedJobIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  function handleGenerate() {
    generateInvoice({
      sessions: activeSessions,
      jobs,
      employees,
      dateRange,
      company: company || {},
      clientName,
      invoiceNum,
      selectedJobIds: selectedJobIds.length > 0 ? selectedJobIds : null,
    });
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Generate Invoice" subtitle="PDF will download to your device" onClose={onClose} />

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Bill To (Client)</label>
        <input style={inp} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. John Doe" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Invoice Number</label>
        <input style={inp} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
      </div>

      {activeJobs.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Filter by Job (optional)</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeJobs.map(j => {
              const isSelected = selectedJobIds.includes(j.id);
              return (
                <button key={j.id} onClick={() => toggleJob(j.id)}
                  style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: isSelected ? '2px solid #E8651A' : '1px solid #e8e8e8', background: isSelected ? '#FEF5E7' : '#fff' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                  <span style={{ color: '#333', fontSize: 13, flex: 1, textAlign: 'left' }}>{j.name}</span>
                  {isSelected && <span style={{ color: '#E8651A', fontSize: 16, fontWeight: 700 }}>&#10003;</span>}
                </button>
              );
            })}
          </div>
          {selectedJobIds.length === 0 && (
            <div style={{ color: '#aaa', fontSize: 11, marginTop: 6 }}>No filter — all jobs will be included</div>
          )}
        </div>
      )}

      {!company?.name && (
        <div style={{ background: '#FEF5E7', border: '1px solid #FDEBD0', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: '#E67E22' }}>
          Set up your company info in the Jobs tab → Company section to have it appear on invoices.
        </div>
      )}

      <button onClick={handleGenerate}
        style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: done ? '#3BB273' : '#E8651A', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif" }}>
        {done ? 'Downloaded!' : 'Generate PDF'}
      </button>
    </Modal>
  );
}
