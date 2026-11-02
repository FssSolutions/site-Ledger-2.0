import { useState, useMemo } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl, card } from '../styles.js';
import generateInvoice from '../lib/generateInvoice.js';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { calcEarnings, calcDur } from '../lib/utils.js';

function toDateInput(d) {
  return d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
}

export default function InvoiceModal({ sessions, jobs, employees, customers, dateRange, company, taxRate, onClose, onRecordInvoice, voiceRequest = null }) {
  const accent = useAccentColor();
  const [selectedCustId, setSelectedCustId] = useState(voiceRequest?.customer_id || '');
  const [invoiceNum, setInvoiceNum] = useState(() => {
    const n = parseInt(localStorage.getItem('sl_next_invoice_num') || '1', 10);
    return `INV-${String(n).padStart(3, '0')}`;
  });
  const [selectedJobIds, setSelectedJobIds] = useState(voiceRequest?.job_ids || []);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amountStr, setAmountStr] = useState(''); // empty = use the calculated total
  const [makePdf, setMakePdf] = useState(() => {
    try { return localStorage.getItem('sl_invoice_make_pdf') === '1'; } catch { return false; }
  });

  const [startStr, setStartStr] = useState(() => {
    if (voiceRequest?.date_range_start) return voiceRequest.date_range_start;
    return toDateInput(dateRange?.[0]) || toDateInput(new Date(Date.now() - 30 * 86400000));
  });
  const [endStr, setEndStr] = useState(() => {
    if (voiceRequest?.date_range_end) return voiceRequest.date_range_end;
    return toDateInput(dateRange?.[1]) || toDateInput(new Date());
  });

  const rs = useMemo(() => startStr ? new Date(startStr + 'T00:00:00') : null, [startStr]);
  const re = useMemo(() => endStr ? new Date(endStr + 'T23:59:59') : null, [endStr]);

  const rangeSessions = useMemo(() => {
    if (!rs || !re) return [];
    return sessions.filter(s => {
      if (!s.end_time) return false;
      const t = new Date(s.start_time);
      return t >= rs && t <= re;
    });
  }, [sessions, rs, re]);
  // Only unbilled hours can go on a new invoice; already-billed ones are reported separately.
  const activeSessions = useMemo(() => rangeSessions.filter(s => !s.invoice_id), [rangeSessions]);
  const alreadyBilled = useMemo(() => rangeSessions.filter(s => s.invoice_id), [rangeSessions]);

  const activeJobIds = useMemo(() => [...new Set(activeSessions.map(s => s.job_id))], [activeSessions]);
  const activeJobs = useMemo(() => jobs.filter(j => activeJobIds.includes(j.id)), [jobs, activeJobIds]);

  const selectedCustomer = customers.find(c => c.id === selectedCustId) || null;

  const billSessions = useMemo(
    () => activeSessions.filter(s => selectedJobIds.length === 0 || selectedJobIds.includes(s.job_id)),
    [activeSessions, selectedJobIds]
  );
  const subtotal = useMemo(() => billSessions.reduce((s, x) => s + calcEarnings(x, jobs, employees, company), 0), [billSessions, jobs, employees, company]);
  const total = subtotal + subtotal * (taxRate / 100);
  const billHours = billSessions.reduce((s, x) => s + calcDur(x), 0) / 3600000;
  const amount = amountStr === '' ? parseFloat(total.toFixed(2)) : parseFloat(amountStr);
  const amountValid = Number.isFinite(amount) && amount >= 0;

  function toggleJob(id) {
    setSelectedJobIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  function toggleMakePdf(v) {
    setMakePdf(v);
    try { localStorage.setItem('sl_invoice_make_pdf', v ? '1' : '0'); } catch {}
  }

  async function handleGenerate() {
    if (!rs || !re || re < rs || saving || !amountValid) return;
    setSaving(true);
    // Save the record before downloading the PDF. On mobile (esp. iOS PWAs) the
    // download can background the page and abort any in-flight request.
    const ok = onRecordInvoice ? await onRecordInvoice({
      customer_id: selectedCustId || null,
      customer_name: selectedCustomer?.name || '',
      amount,
      status: 'unpaid',
      date_generated: new Date().toISOString().slice(0, 10),
      date_range_start: startStr,
      date_range_end: endStr,
      notes: invoiceNum,
    }, billSessions.map(s => s.id)) : true;
    setSaving(false);
    if (makePdf) {
      generateInvoice({
        sessions: billSessions,
        jobs,
        employees,
        dateRange: [rs, re],
        company: company || {},
        customer: selectedCustomer,
        invoiceNum,
        selectedJobIds: null,
        accentColor: accent,
        taxRate,
      });
    }
    if (!ok) return;
    const match = invoiceNum.match(/(\d+)/);
    if (match) {
      const next = parseInt(match[1], 10) + 1;
      localStorage.setItem('sl_next_invoice_num', String(next));
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  const dateRangeValid = rs && re && re >= rs;

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Invoice" subtitle="Mark these hours as billed once you've invoiced them in QuickBooks" onClose={onClose} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>From</label>
          <input type="date" style={inp} value={startStr} onChange={e => setStartStr(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>To</label>
          <input type="date" style={inp} value={endStr} onChange={e => setEndStr(e.target.value)} />
        </div>
      </div>

      {dateRangeValid && activeJobs.length === 0 && (
        <div style={{ color: '#aaa', fontSize: 12, padding: '10px 14px', background: '#f9f9f9', borderRadius: 10, marginBottom: 16 }}>
          {alreadyBilled.length > 0 ? 'All hours in this date range have already been billed.' : 'No completed sessions in this date range.'}
        </div>
      )}

      {dateRangeValid && alreadyBilled.length > 0 && (() => {
        const nums = [...new Set(alreadyBilled.map(s => s.invoice_id))];
        return (
          <div style={{ background: '#EBF5FB', border: '1px solid #D6EAF8', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#2E86AB' }}>
            {alreadyBilled.length} entr{alreadyBilled.length === 1 ? 'y' : 'ies'} in this range {alreadyBilled.length === 1 ? 'was' : 'were'} already billed ({nums.length} invoice{nums.length === 1 ? '' : 's'}) and {alreadyBilled.length === 1 ? 'is' : 'are'} left out.
          </div>
        );
      })()}

      {activeJobs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Jobs to include</label>
            {selectedJobIds.length > 0 && (
              <button type="button" onClick={() => setSelectedJobIds([])} style={{ fontSize: 11, color: accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                Clear ({selectedJobIds.length})
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeJobs.map(j => {
              const isSelected = selectedJobIds.includes(j.id);
              return (
                <label key={j.id}
                  style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: isSelected ? `2px solid ${j.color}` : '1px solid #e8e8e8', background: isSelected ? `${j.color}15` : '#fff' }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleJob(j.id)}
                    style={{ width: 18, height: 18, flexShrink: 0, accentColor: j.color, cursor: 'pointer' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                  <span style={{ color: '#333', fontSize: 13, flex: 1, textAlign: 'left' }}>{j.name}</span>
                </label>
              );
            })}
          </div>
          {selectedJobIds.length === 0 && (
            <div style={{ color: '#aaa', fontSize: 11, marginTop: 6 }}>None checked — all jobs in range will be included. Check one or more to invoice only those jobs.</div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Bill To (Customer)</label>
        <select style={{ ...inp, appearance: 'auto' }} value={selectedCustId} onChange={e => setSelectedCustId(e.target.value)}>
          <option value="">— Select a customer —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <label style={lbl}>Invoice Number (as in QuickBooks)</label>
        <input style={inp} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
      </div>

      {billSessions.length > 0 && (
        <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#888' }}>{billSessions.length} unbilled entr{billSessions.length !== 1 ? 'ies' : 'y'} · {billHours.toFixed(2)} hrs</span>
          <span style={{ fontWeight: 700, color: '#111' }}>${total.toFixed(2)} CAD incl. tax</span>
        </div>
      )}

      {billSessions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Amount Billed (CAD)</label>
          <input style={inp} type="number" inputMode="decimal" min="0" step="0.01"
            value={amountStr === '' ? total.toFixed(2) : amountStr}
            onChange={e => setAmountStr(e.target.value)} />
          <div style={{ color: '#aaa', fontSize: 11, marginTop: 6 }}>
            {amountStr === '' ? 'Change this if your QuickBooks invoice total is different, e.g. with materials added.'
              : <>Calculated from hours: ${total.toFixed(2)}. <span onClick={() => setAmountStr('')} style={{ color: accent, cursor: 'pointer', fontWeight: 600 }}>Reset</span></>}
          </div>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontSize: 13, color: '#333', cursor: 'pointer' }}>
        <input type="checkbox" checked={makePdf} onChange={e => toggleMakePdf(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: accent, cursor: 'pointer' }} />
        Also download a PDF invoice
      </label>

      {makePdf && !company?.name && (
        <div style={{ background: '#FEF5E7', border: '1px solid #FDEBD0', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: '#E67E22' }}>
          Set up your company info in the Company tab → Profile section to have it appear on invoices.
        </div>
      )}

      {(() => {
        const canSubmit = dateRangeValid && billSessions.length > 0 && amountValid && !saving;
        return (
          <button onClick={handleGenerate}
            disabled={!canSubmit}
            style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: done ? '#3BB273' : canSubmit ? accent : '#e8e8e8', color: done || canSubmit ? '#fff' : '#aaa', fontSize: 15, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: "'Syne', sans-serif" }}>
            {done ? 'Marked as Billed!' : saving ? 'Saving…' : makePdf ? 'Mark as Billed & Download PDF' : 'Mark as Billed'}
          </button>
        );
      })()}
    </Modal>
  );
}
