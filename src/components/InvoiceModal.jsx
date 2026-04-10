import { useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl } from '../styles.js';
import generateInvoice from '../lib/generateInvoice.js';

export default function InvoiceModal({ sessions, jobs, employees, mileage, dateRange, onClose }) {
  const [companyName, setCompanyName] = useState('');
  const [clientName, setClientName] = useState('');
  const [invoiceNum, setInvoiceNum] = useState('INV-001');
  const [done, setDone] = useState(false);

  function handleGenerate() {
    generateInvoice({ sessions, jobs, employees, mileage, dateRange, companyName, clientName, invoiceNum });
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Generate Invoice" subtitle="PDF will download to your device" onClose={onClose} />

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Your Company / Name</label>
        <input style={inp} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Smith Carpentry" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Bill To (Client)</label>
        <input style={inp} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. John Doe" />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={lbl}>Invoice Number</label>
        <input style={inp} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
      </div>

      <button onClick={handleGenerate}
        style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: done ? '#3BB273' : '#E8651A', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif" }}>
        {done ? 'Downloaded!' : 'Generate PDF'}
      </button>
    </Modal>
  );
}
