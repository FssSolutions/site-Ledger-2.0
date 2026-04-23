import { useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl, card } from '../styles.js';
import generateInvoice from '../lib/generateInvoice.js';
import InvoicePreview from './InvoicePreview.jsx';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { calcEarnings } from '../lib/utils.js';

export default function InvoiceModal({ sessions, jobs, employees, customers, dateRange, company, taxRate, onClose, onSaveInvoice }) {
  const accent = useAccentColor();
  const [selectedCustId, setSelectedCustId] = useState('');
  const [invoiceNum, setInvoiceNum] = useState(() => {
    const n = parseInt(localStorage.getItem('sl_next_invoice_num') || '1', 10);
    return `INV-${String(n).padStart(3, '0')}`;
  });
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState('configure'); // 'configure' | 'preview'

  // Jobs that have sessions in the date range
  const [rs, re] = dateRange;
  const activeSessions = sessions.filter(s => {
    if (!s.end_time) return false;
    const t = new Date(s.start_time);
    return t >= rs && t <= re;
  });
  const activeJobIds = [...new Set(activeSessions.map(s => s.job_id))];
  const activeJobs = jobs.filter(j => activeJobIds.includes(j.id));

  const selectedCustomer = customers.find(c => c.id === selectedCustId) || null;

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
      customer: selectedCustomer,
      invoiceNum,
      selectedJobIds: selectedJobIds.length > 0 ? selectedJobIds : null,
      accentColor: accent,
      taxRate,
    });
    const match = invoiceNum.match(/(\d+)/);
    if (match) {
      const next = parseInt(match[1], 10) + 1;
      localStorage.setItem('sl_next_invoice_num', String(next));
    }
    if (onSaveInvoice) {
      const billSessions = activeSessions.filter(s => selectedJobIds.length === 0 || selectedJobIds.includes(s.job_id));
      const subtotal = billSessions.reduce((s, x) => s + calcEarnings(x, jobs), 0);
      const total = subtotal + subtotal * (taxRate / 100);
      const [rs, re] = dateRange;
      onSaveInvoice({
        customer_id: selectedCustId || null,
        customer_name: selectedCustomer?.name || '',
        amount: parseFloat(total.toFixed(2)),
        status: 'unpaid',
        date_generated: new Date().toISOString().slice(0, 10),
        date_range_start: rs.toISOString().slice(0, 10),
        date_range_end: re.toISOString().slice(0, 10),
        notes: invoiceNum,
      });
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  if (step === 'preview') {
    return (
      <Modal onClose={onClose}>
        <ModalHeader title="Invoice Preview" subtitle="Review before downloading" onClose={onClose} />
        <InvoicePreview
          sessions={activeSessions}
          jobs={jobs}
          employees={employees}
          dateRange={dateRange}
          company={company || {}}
          customer={selectedCustomer}
          invoiceNum={invoiceNum}
          selectedJobIds={selectedJobIds.length > 0 ? selectedJobIds : null}
          taxRate={taxRate}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => setStep('configure')}
            style={{ flex: 1, padding: '14px', borderRadius: 12, border: `1.5px solid ${accent}`, background: '#fff', color: accent, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif" }}
          >
            Back
          </button>
          <button
            onClick={handleGenerate}
            style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: done ? '#3BB273' : accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif" }}
          >
            {done ? 'Downloaded!' : 'Download PDF'}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Generate Invoice" subtitle="Preview before downloading" onClose={onClose} />

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Bill To (Customer)</label>
        <select
          style={{ ...inp, appearance: 'auto' }}
          value={selectedCustId}
          onChange={e => setSelectedCustId(e.target.value)}
        >
          <option value="">— Select a customer —</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {selectedCustomer && (
          <div style={{ marginTop: 8, padding: '10px 14px', background: '#f9f9f9', borderRadius: 10, border: '1px solid #e8e8e8', fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: '#333' }}>{selectedCustomer.name}</div>
            {selectedCustomer.address && <div>{selectedCustomer.address}</div>}
            {selectedCustomer.phone && <div>{selectedCustomer.phone}</div>}
            {selectedCustomer.email && <div>{selectedCustomer.email}</div>}
          </div>
        )}
        {customers.length === 0 && (
          <div style={{ color: '#aaa', fontSize: 11, marginTop: 6 }}>No customers yet — add them in the Company tab.</div>
        )}
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
                  style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: isSelected ? `2px solid ${accent}` : '1px solid #e8e8e8', background: isSelected ? `${accent}18` : '#fff' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                  <span style={{ color: '#333', fontSize: 13, flex: 1, textAlign: 'left' }}>{j.name}</span>
                  {isSelected && <span style={{ color: accent, fontSize: 16, fontWeight: 700 }}>&#10003;</span>}
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
          Set up your company info in the Company tab → Profile section to have it appear on invoices.
        </div>
      )}

      <button onClick={() => setStep('preview')}
        style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif" }}>
        Preview Invoice
      </button>
    </Modal>
  );
}
