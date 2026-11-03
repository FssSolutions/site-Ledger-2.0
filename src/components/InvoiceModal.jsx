import { useState, useMemo, useId } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl, card } from '../styles.js';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { calcDur } from '../lib/utils.js';
import { buildInvoiceLines, totalsFromLines, toRpcLine, fmtCAD, toCents, duplicateFixedBillings } from '../lib/billing.js';
import { localDateKey, todayKey, addDaysKey, sessionInRange } from '../lib/time.js';
import { newId } from '../lib/ledgerStore.js';

function nextInvoiceNumber() {
  try {
    const n = parseInt(localStorage.getItem('sl_next_invoice_num') || '1', 10);
    return `INV-${String(Number.isFinite(n) ? n : 1).padStart(3, '0')}`;
  } catch { return 'INV-001'; }
}

// Records an invoice that was created in QuickBooks and marks its hours as
// billed. This app does not create, send, or update anything in QuickBooks.
export default function InvoiceModal({ sessions, jobs, employees, customers, dateRange, company, taxRate, onClose, ledger, toast, voiceRequest = null }) {
  const accent = useAccentColor();
  const id = useId();
  const [selectedCustId, setSelectedCustId] = useState(() => (voiceRequest?.customer_id && customers.some(c => c.id === voiceRequest.customer_id) ? voiceRequest.customer_id : ''));
  const [invoiceNum, setInvoiceNum] = useState(nextInvoiceNumber);
  const [selectedJobIds, setSelectedJobIds] = useState(() => (voiceRequest?.job_ids || []).filter(j => jobs.some(x => x.id === j)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recorded, setRecorded] = useState(null);
  const [amountStr, setAmountStr] = useState('');
  // One request id per invoice attempt: a retry after a lost response is
  // recognised by the server instead of creating a second invoice.
  const [requestId, setRequestId] = useState(newId);
  const [makePdf, setMakePdf] = useState(() => { try { return localStorage.getItem('sl_invoice_make_pdf') === '1'; } catch { return false; } });

  const validKey = k => (typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
  const [startStr, setStartStr] = useState(() => validKey(voiceRequest?.date_range_start) || (Array.isArray(dateRange) && validKey(dateRange[0]) && dateRange[0] !== '0000-01-01' ? dateRange[0] : addDaysKey(todayKey(), -30)));
  const [endStr, setEndStr] = useState(() => validKey(voiceRequest?.date_range_end) || (Array.isArray(dateRange) && validKey(dateRange[1]) && dateRange[1] !== '9999-12-31' ? dateRange[1] : todayKey()));
  const range = [startStr, endStr];
  const dateRangeValid = !!(startStr && endStr && endStr >= startStr);
  const data = { jobs, employees, company };

  const rangeSessions = useMemo(() => (dateRangeValid ? sessions.filter(s => s.end_time && sessionInRange(s, range)) : []), [sessions, startStr, endStr, dateRangeValid]); // eslint-disable-line react-hooks/exhaustive-deps
  const unbilled = rangeSessions.filter(s => !s.invoice_id);
  const alreadyBilled = rangeSessions.filter(s => s.invoice_id);
  const activeJobIds = [...new Set(unbilled.map(s => s.job_id))];
  const activeJobs = jobs.filter(j => activeJobIds.includes(j.id));
  const selectedCustomer = customers.find(c => c.id === selectedCustId) || null;

  const billSessions = unbilled.filter(s => selectedJobIds.length === 0 || selectedJobIds.includes(s.job_id));
  const unsynced = billSessions.filter(s => s._sync !== 'synced');
  const lines = useMemo(() => buildInvoiceLines(billSessions, data, localDateKey), [billSessions, jobs, employees, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const missingDayType = lines.filter(l => l.missing === 'day_type').length;
  const missingRate = lines.filter(l => l.missing === 'rate').length;
  const dupFixed = duplicateFixedBillings(billSessions, data, localDateKey);
  const totals = totalsFromLines(lines, taxRate);
  const overrideCents = amountStr === '' ? null : toCents(amountStr);
  const amountValid = overrideCents == null || (Number.isFinite(Number(amountStr)) && Number(amountStr) >= 0);
  const amountCents = overrideCents ?? totals.totalCents;
  const overridden = overrideCents != null && overrideCents !== totals.totalCents;
  const billHours = billSessions.reduce((s, x) => s + calcDur(x), 0) / 3600000;

  const canSubmit = dateRangeValid && billSessions.length > 0 && amountValid && !saving && unsynced.length === 0 && missingDayType === 0 && missingRate === 0 && invoiceNum.trim() && !recorded;

  function toggleJob(jid) { setSelectedJobIds(p => (p.includes(jid) ? p.filter(x => x !== jid) : [...p, jid])); setRequestId(newId()); }
  function toggleMakePdf(v) { setMakePdf(v); try { localStorage.setItem('sl_invoice_make_pdf', v ? '1' : '0'); } catch { /* ignore */ } }

  async function handleRecord() {
    if (!canSubmit) return;
    setSaving(true); setError('');
    const invoice = {
      id: requestId,
      customer_id: selectedCustId || null,
      customer_name: selectedCustomer?.name || '',
      status: 'unpaid',
      date_generated: todayKey(),
      date_range_start: startStr,
      date_range_end: endStr,
      notes: invoiceNum.trim(),
      subtotal: (totals.subtotalCents / 100).toFixed(2),
      tax_rate: Number(taxRate || 0),
      tax_amount: (totals.taxCents / 100).toFixed(2),
      calculated_total: (totals.totalCents / 100).toFixed(2),
      amount: (amountCents / 100).toFixed(2),
    };
    const r = await ledger.recordInvoice(invoice, billSessions.map(s => s.id), lines.map(toRpcLine));
    setSaving(false);
    if (!r.ok) {
      setError(r.error + (r.retryable ? ' Pressing the button again is safe — it will not create a second invoice.' : ''));
      return;
    }
    const match = invoiceNum.match(/(\d+)/);
    if (match) { try { localStorage.setItem('sl_next_invoice_num', String(parseInt(match[1], 10) + 1)); } catch { /* ignore */ } }
    setRecorded(r.data);
    toast?.(`Recorded ${invoiceNum.trim()}: ${billSessions.length} entr${billSessions.length === 1 ? 'y' : 'ies'} marked as billed.`, 'success');
    if (makePdf && !overridden) await downloadPdf(r.data);
  }

  async function downloadPdf(rec) {
    try {
      const { default: generateInvoice } = await import('../lib/generateInvoice.js');
      generateInvoice({ invoice: rec.invoice, lines: rec.lines, company: company || {}, customer: selectedCustomer, accentColor: accent });
    } catch {
      toast?.('The invoice was recorded, but the PDF could not be created on this device.');
    }
  }

  if (recorded) {
    return (
      <Modal onClose={onClose}>
        <ModalHeader title="Invoice recorded" subtitle={recorded.invoice?.notes} onClose={onClose} />
        <div style={{ fontSize: 14, color: '#333', lineHeight: 1.6, marginBottom: 16 }}>
          {recorded.lines.length} entr{recorded.lines.length === 1 ? 'y is' : 'ies are'} now marked as billed. Amount recorded: <b>{fmtCAD(toCents(recorded.invoice?.amount))}</b>.
          {recorded.replayed && <div style={{ color: '#666', fontSize: 12 }}>This invoice had already been recorded; no duplicate was created.</div>}
        </div>
        {!overridden && <button type="button" onClick={() => downloadPdf(recorded)} style={{ width: '100%', padding: 13, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontWeight: 700, marginBottom: 8 }}>Download PDF</button>}
        <button type="button" onClick={onClose} data-autofocus style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: accent, color: '#fff', fontWeight: 700 }}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Record invoice" subtitle="After you create the invoice in QuickBooks, record it here to mark those hours as billed" onClose={onClose} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label htmlFor={`${id}-from`} style={lbl}>From</label>
          <input id={`${id}-from`} type="date" style={inp} value={startStr} onChange={e => { setStartStr(e.target.value); setRequestId(newId()); }} />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor={`${id}-to`} style={lbl}>To</label>
          <input id={`${id}-to`} type="date" style={inp} value={endStr} onChange={e => { setEndStr(e.target.value); setRequestId(newId()); }} />
        </div>
      </div>

      {dateRangeValid && unbilled.length === 0 && (
        <div style={note('#f9f9f9', '#666')}>{alreadyBilled.length > 0 ? 'All hours in this date range have already been billed.' : 'No completed sessions in this date range.'}</div>
      )}
      {dateRangeValid && alreadyBilled.length > 0 && (
        <div style={note('#EBF5FB', '#1B6C8F')}>
          {alreadyBilled.length} entr{alreadyBilled.length === 1 ? 'y' : 'ies'} in this range {alreadyBilled.length === 1 ? 'is' : 'are'} already billed and left out.
        </div>
      )}

      {activeJobs.length > 0 && (
        <div role="group" aria-labelledby={`${id}-jobs`} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div id={`${id}-jobs`} style={{ ...lbl, marginBottom: 0 }}>Jobs to include</div>
            {selectedJobIds.length > 0 && (
              <button type="button" onClick={() => { setSelectedJobIds([]); setRequestId(newId()); }} style={{ fontSize: 12, color: accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Clear ({selectedJobIds.length})</button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeJobs.map(j => {
              const isSelected = selectedJobIds.includes(j.id);
              return (
                <label key={j.id} style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: isSelected ? `2px solid ${j.color}` : '1px solid #e8e8e8', background: isSelected ? `${j.color}15` : '#fff' }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleJob(j.id)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: j.color }} />
                  <span style={{ color: '#333', fontSize: 13, flex: 1 }}>{j.name}</span>
                </label>
              );
            })}
          </div>
          {selectedJobIds.length === 0 && <div style={{ color: '#777', fontSize: 12, marginTop: 6 }}>None checked — all jobs in range are included.</div>}
        </div>
      )}

      {unsynced.length > 0 && (
        <div role="alert" style={note('#fff8f0', '#7a4a10')}>
          {unsynced.length} of these entr{unsynced.length === 1 ? 'y has' : 'ies have'} not reached the server yet. Hours can only be marked billed once they've synced.
          <button type="button" onClick={() => ledger.syncNow()} style={{ display: 'block', marginTop: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid #e0b070', background: '#fff', fontWeight: 700 }}>Sync now</button>
        </div>
      )}
      {missingDayType > 0 && <div role="alert" style={note('#fde8e8', '#a93226')}>{missingDayType} fixed-price entr{missingDayType === 1 ? 'y needs' : 'ies need'} Half Day or Full Day chosen before billing.</div>}
      {missingRate > 0 && <div role="alert" style={note('#fde8e8', '#a93226')}>{missingRate} entr{missingRate === 1 ? 'y has' : 'ies have'} no billing rate. Set the job's rate first.</div>}
      {dupFixed.length > 0 && <div style={note('#fff8f0', '#7a4a10')}>Check: {dupFixed.length} worker{dupFixed.length === 1 ? ' is' : 's are'} billed twice for the same fixed-price job on the same day. Fixed-price jobs bill once per person per day.</div>}

      <div style={{ marginBottom: 16 }}>
        <label htmlFor={`${id}-cust`} style={lbl}>Bill To (Customer)</label>
        <select id={`${id}-cust`} style={{ ...inp, appearance: 'auto' }} value={selectedCustId} onChange={e => setSelectedCustId(e.target.value)}>
          <option value="">— Select a customer —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor={`${id}-num`} style={lbl}>Invoice Number (as in QuickBooks)</label>
        <input id={`${id}-num`} style={inp} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
      </div>

      {lines.length > 0 && (
        <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}><span>{billSessions.length} entr{billSessions.length !== 1 ? 'ies' : 'y'} · {billHours.toFixed(2)} hrs</span><span>Subtotal {fmtCAD(totals.subtotalCents)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}><span /><span>GST {taxRate}% {fmtCAD(totals.taxCents)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#111', marginTop: 4 }}><span>Calculated total</span><span>{fmtCAD(totals.totalCents)}</span></div>
        </div>
      )}

      {lines.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={`${id}-amt`} style={lbl}>Amount on the QuickBooks invoice (CAD, incl. tax)</label>
          <input id={`${id}-amt`} style={inp} type="number" inputMode="decimal" min="0" step="0.01"
            value={amountStr === '' ? (totals.totalCents / 100).toFixed(2) : amountStr}
            onChange={e => { setAmountStr(e.target.value); setRequestId(newId()); }} />
          <div style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
            {overridden
              ? <>Differs from the calculated {fmtCAD(totals.totalCents)} (e.g. materials added in QuickBooks). Both are recorded. A PDF from this app would not match, so use the QuickBooks PDF. <button type="button" onClick={() => setAmountStr('')} style={{ color: accent, background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer' }}>Reset</button></>
              : 'Change this only if the QuickBooks total is different.'}
          </div>
        </div>
      )}

      {!overridden && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontSize: 13, color: '#333', cursor: 'pointer' }}>
          <input type="checkbox" checked={makePdf} onChange={e => toggleMakePdf(e.target.checked)} style={{ width: 18, height: 18, accentColor: accent }} />
          Also download a PDF after it is recorded
        </label>
      )}

      {error && <div role="alert" style={note('#fde8e8', '#a93226')}>{error}</div>}

      <button type="button" onClick={handleRecord} disabled={!canSubmit}
        style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: canSubmit ? accent : '#e0e0e0', color: canSubmit ? '#fff' : '#777', fontSize: 15, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: "'Syne', sans-serif" }}>
        {saving ? 'Recording…' : 'Record invoice & mark billed'}
      </button>
      <div style={{ color: '#777', fontSize: 11, marginTop: 8, textAlign: 'center' }}>Needs internet. Nothing is sent to QuickBooks.</div>
    </Modal>
  );
}

const note = (bg, color) => ({ background: bg, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color, lineHeight: 1.5 });
