import { useMemo, useState, lazy, Suspense } from 'react';
import Icon from '../components/Icon.jsx';
import { card, inp } from '../styles.js';
import { fmtDur, calcDur } from '../lib/utils.js';
import { fmtCAD, sessionBilling, sessionLabourCents, summarize, toCents } from '../lib/billing.js';
import { presetRange, sessionInRange, inRange, localDateKey, localTimeHHMM } from '../lib/time.js';
import { overtimeForRange } from '../lib/overtime.js';
import { mileageEstimates } from '../lib/mileage.js';
import { toCsv, downloadText } from '../lib/csv.js';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { useQboMode } from '../hooks/useQboMode.js';

const InvoiceModal = lazy(() => import('../components/InvoiceModal.jsx'));

const Stat = ({ label, value, color = '#111', hint }) => (
  <div style={{ ...card, padding: '16px 18px' }} title={hint}>
    <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color }}>{value}</div>
    {hint && <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>{hint}</div>}
  </div>
);

export default function ReportsTab({ jobs, employees, sessions, openSessions = [], mileage, expenses, company, customers, taxRate, otRules, isDesktop, ledger, toast }) {
  const accent = useAccentColor();
  // Only accounts that use QuickBooks see QuickBooks wording.
  const qboMode = useQboMode(ledger);
  const [pre, setPre] = useState('month');
  const [cs, setCs] = useState('');
  const [ce, setCe] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);
  const range = presetRange(pre, new Date(), { start: cs, end: ce });
  const data = { jobs, employees, company };

  const f = useMemo(() => sessions.filter(s => s.end_time && sessionInRange(s, range)), [sessions, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const fm = mileage.filter(m => inRange(String(m.date), range));
  const fe = (expenses || []).filter(e => inRange(String(e.date), range));
  const sum = summarize(f, data);
  const expensesCents = fe.reduce((s, x) => s + toCents(x.amount), 0);
  const marginCents = sum.revenueCents - sum.labourCents - expensesCents;
  const tm = f.reduce((s, x) => s + calcDur(x), 0);
  const totalKm = fm.reduce((s, x) => s + Number(x.km || 0), 0);
  const est = mileageEstimates(mileage);
  const kmEstimateCents = fm.reduce((s, m) => s + (est[m.id]?.cents || 0), 0);
  const kmUnverified = fm.some(m => est[m.id] && !est[m.id].verified);

  const bj = jobs.map(j => {
    const js = f.filter(s => s.job_id === j.id);
    const s2 = summarize(js, data);
    const exp = fe.filter(e => e.job_id === j.id).reduce((a, e) => a + toCents(e.amount), 0);
    return { ...j, revenue: s2.revenueCents, labour: s2.labourCents, exp, h: js.reduce((s, x) => s + calcDur(x), 0), n: js.length };
  }).filter(j => j.n > 0 || j.exp > 0).sort((a, b) => b.revenue - a.revenue);

  const be = employees.map(e => {
    const es = f.filter(s => s.employee_id === e.id);
    const s2 = summarize(es, data);
    return { ...e, hrs: es.reduce((a, x) => a + calcDur(x), 0) / 3600000, cost: s2.labourCents, billed: s2.revenueCents, n: es.length };
  }).filter(e => e.n > 0).sort((a, b) => b.hrs - a.hrs);

  const ot = overtimeForRange(sessions, range, otRules);
  const workerName = w => (w === 'owner' ? 'Me (owner)' : employees.find(e => e.id === w)?.name || 'Former crew member');

  function exportCSV() {
    const rows = [['Date', 'Job', 'Worker', 'Start', 'End', 'Break (min)', 'Hours', 'Billing basis', 'Billed rate', 'Billed (CAD)', 'Wage rate', 'Wages (CAD)', 'Invoiced']];
    [...f].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)).forEach(s => {
      const j = jobs.find(x => x.id === s.job_id);
      const emp = employees.find(x => x.id === s.employee_id);
      const b = sessionBilling(s, data);
      rows.push([
        localDateKey(s.start_time), j?.name || '', emp?.name || 'Owner', localTimeHHMM(s.start_time), localTimeHHMM(s.end_time),
        Math.round((s.break_seconds || 0) / 60), Number((calcDur(s) / 3600000).toFixed(2)), b.basis || '',
        b.unitPriceCents / 100, b.amountCents / 100, s.employee_id ? Number(s.cost_rate ?? emp?.rate ?? 0) : '',
        s.employee_id ? sessionLabourCents(s, data) / 100 : '', s.invoice_id ? 'yes' : 'no',
      ]);
    });
    downloadText(`site-ledger-${range[0]}-to-${range[1]}.csv`, toCsv(rows, { numericCols: [5, 6, 8, 9, 10, 11] }));
  }

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      {showInvoice && (
        <Suspense fallback={null}>
          <InvoiceModal sessions={sessions} openSessions={openSessions} jobs={jobs} employees={employees} customers={customers}
            dateRange={range} company={company} taxRate={taxRate} ledger={ledger} toast={toast} onClose={() => setShowInvoice(false)} />
        </Suspense>
      )}

      <div role="group" aria-label="Report period" style={{ display: 'flex', gap: 6, padding: '16px 16px 0', flexWrap: 'wrap' }}>
        {[{ id: 'week', l: '7 Days' }, { id: 'month', l: 'This Month' }, { id: 'lastmonth', l: 'Last Month' }, { id: 'year', l: 'This Year' }, { id: 'custom', l: 'Custom' }].map(p => (
          <button key={p.id} type="button" onClick={() => setPre(p.id)} aria-pressed={pre === p.id}
            style={{ padding: '8px 14px', borderRadius: 20, border: pre === p.id ? 'none' : '1px solid #ddd', background: pre === p.id ? accent : '#fff', color: pre === p.id ? '#fff' : '#555', fontSize: 13, fontWeight: pre === p.id ? 700 : 400, cursor: 'pointer' }}>
            {p.l}
          </button>
        ))}
      </div>

      {pre === 'custom' && (
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
          <input aria-label="From date" type="date" value={cs} onChange={e => setCs(e.target.value)} style={{ ...inp, flex: 1 }} />
          <input aria-label="To date" type="date" value={ce} onChange={e => setCe(e.target.value)} style={{ ...inp, flex: 1 }} />
        </div>
      )}
      <div style={{ padding: '8px 16px 0', color: '#777', fontSize: 12 }}>{range[0] === '0000-01-01' ? 'All dates' : `${range[0]} to ${range[1]}`} · local time</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 16px 0' }}>
        <Stat label="Billable" value={fmtCAD(sum.revenueCents)} color={accent} hint="Job rates × hours, before tax" />
        <Stat label="Hours" value={fmtDur(tm)} />
        <Stat label="Crew wages" value={fmtCAD(sum.labourCents)} hint="Employee wages × hours" />
        <Stat label="Expenses" value={fmtCAD(expensesCents)} color="#A93226" />
        <Stat label="Gross margin" value={fmtCAD(marginCents)} color={marginCents >= 0 ? '#1e6b3a' : '#A93226'} hint="Billable − wages − expenses (your own pay not deducted)" />
        <Stat label="Mileage" value={`${totalKm.toFixed(0)} km`} hint={`≈ ${fmtCAD(kmEstimateCents)} at CRA allowance rates${kmUnverified ? ' (rate unverified)' : ''}`} />
      </div>
      {(sum.legacyCount > 0 || sum.missingCount > 0) && (
        <div style={{ margin: '10px 16px 0', fontSize: 12, color: '#7a4a10', background: '#fff8f0', border: '1px solid #f0c070', borderRadius: 10, padding: '8px 12px' }}>
          {sum.legacyCount > 0 && <div>{sum.legacyCount} entr{sum.legacyCount === 1 ? 'y was' : 'ies were'} recorded before rates were saved with each entry, so {sum.legacyCount === 1 ? 'it uses' : 'they use'} the current job and wage rates.</div>}
          {sum.missingCount > 0 && <div>{sum.missingCount} fixed-price entr{sum.missingCount === 1 ? 'y has' : 'ies have'} no half/full day chosen and bill $0 until edited.</div>}
        </div>
      )}

      {ot.enabled && ot.workers.length > 0 && (
        <section aria-label="Overtime flags" style={{ ...card, margin: '16px 16px 0', padding: '20px 24px', border: '1px solid #FDEBD0' }}>
          <div style={{ color: '#A35A10', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Overtime flags</div>
          <div style={{ color: '#777', fontSize: 12, marginBottom: 12 }}>Per worker, BC rules (8 h/day, 12 h double, 40 h/week). Reminders only — confirm in payroll.</div>
          {ot.workers.map(w => (
            <div key={w.worker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: '#333', fontSize: 13 }}>{workerName(w.worker)}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {w.dailyOt > 0 && <span style={pill('#FDEBD0', '#A35A10')}>{w.dailyOt.toFixed(1)}h daily OT</span>}
                {w.doubleTime > 0 && <span style={pill('#FADBD8', '#A93226')}>{w.doubleTime.toFixed(1)}h double</span>}
                {w.weeklyOt > 0 && <span style={pill('#FADBD8', '#A93226')}>{w.weeklyOt.toFixed(1)}h weekly OT{w.partialWeeks ? '*' : ''}</span>}
              </div>
            </div>
          ))}
          {ot.workers.some(w => w.partialWeeks) && <div style={{ color: '#777', fontSize: 11, marginTop: 8 }}>* Includes a week that extends beyond this period; weekly overtime is counted on the whole week.</div>}
        </section>
      )}

      {bj.length > 0 && (
        <section aria-label="By job" style={{ ...card, margin: '16px 16px 0', padding: '20px 24px' }}>
          <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>By Job</div>
          {bj.map(j => {
            const pct = sum.revenueCents ? (j.revenue / sum.revenueCents) * 100 : 0;
            return (
              <div key={j.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: j.color }} />
                    <span style={{ color: '#333', fontSize: 13 }}>{j.name}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: '#111', fontSize: 13, fontWeight: 600 }}>{fmtCAD(j.revenue)}</span>
                    <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>{fmtDur(j.h)}</span>
                    {(j.labour > 0 || j.exp > 0) && <div style={{ color: '#777', fontSize: 11 }}>margin {fmtCAD(j.revenue - j.labour - j.exp)}</div>}
                  </div>
                </div>
                <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: j.color, borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </section>
      )}

      {be.length > 0 && (
        <section aria-label="Crew hours" style={{ ...card, margin: '12px 16px 0', padding: '20px 24px' }}>
          <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>Crew</div>
          {be.map(e => (
            <div key={e.id} style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                  <div style={{ color: '#777', fontSize: 12 }}>{e.hrs.toFixed(2)} hrs</div>
                </div>
                <div style={{ background: e.billed - e.cost >= 0 ? '#eafaf1' : '#FADBD8', color: e.billed - e.cost >= 0 ? '#1e6b3a' : '#A93226', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, fontFamily: "'DM Mono', monospace" }}>
                  {fmtCAD(e.billed - e.cost)} after wage
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={miniBox}><div style={miniLbl}>Billed to customers</div><div style={miniVal}>{fmtCAD(e.billed)}</div></div>
                <div style={miniBox}><div style={miniLbl}>Wages</div><div style={miniVal}>{fmtCAD(e.cost)}</div></div>
              </div>
            </div>
          ))}
        </section>
      )}

      {f.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: '#888' }}>No completed sessions in this period</div>}

      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => setShowInvoice(true)}
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
          <Icon name="invoice" size={16} /> {qboMode === 'ready' ? 'Create QuickBooks Invoice & Mark Billed' : 'Record Invoice & Mark Billed'}
        </button>
        {f.length > 0 && (
          <button type="button" onClick={exportCSV} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px solid #ddd', background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="dl" size={14} /> Export CSV
          </button>
        )}
      </div>
    </div>
  );
}

const pill = (bg, color) => ({ background: bg, color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, fontFamily: "'DM Mono', monospace" });
const miniBox = { flex: 1, background: '#f8f8f8', borderRadius: 8, padding: '8px 10px' };
const miniLbl = { color: '#666', fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', marginBottom: 2 };
const miniVal = { color: '#111', fontSize: 13, fontWeight: 600 };
