import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import InvoiceModal from '../components/InvoiceModal.jsx';
import { card, inp } from '../styles.js';
import { CRA_RATE } from '../lib/constants.js';
import { fmtDur, fmtCAD, calcEarnings, calcDur, calcOvertime } from '../lib/utils.js';

export default function ReportsTab({ jobs, employees, sessions, mileage, company, customers, isDesktop }) {
  const [pre, setPre] = useState('month');
  const [cs, setCs] = useState('');
  const [ce, setCe] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);
  const now = new Date();

  function range() {
    if (pre === 'week') { const s = new Date(now); s.setDate(now.getDate() - 6); s.setHours(0, 0, 0, 0); const e = new Date(now); e.setHours(23, 59, 59, 999); return [s, e]; }
    if (pre === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)];
    if (pre === 'lastmonth') { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1), e = new Date(now.getFullYear(), now.getMonth(), 0); e.setHours(23, 59, 59, 999); return [s, e]; }
    if (pre === 'year') return [new Date(now.getFullYear(), 0, 1), now];
    if (pre === 'custom' && cs && ce) { const e = new Date(ce); e.setHours(23, 59, 59, 999); return [new Date(cs), e]; }
    return [new Date(0), new Date(8640000000000000)];
  }

  const [rs, re] = range();
  const f = sessions.filter(s => { const t = new Date(s.start_time); return t >= rs && t <= re && s.end_time; });
  const fm = mileage.filter(m => { const t = new Date(m.date); return t >= rs && t <= re; });
  const te = f.reduce((s, x) => s + calcEarnings(x, jobs), 0);
  const tm = f.reduce((s, x) => s + calcDur(x), 0);
  const totalKm = fm.reduce((s, x) => s + Number(x.km), 0);
  const bj = jobs.map(j => { const js = f.filter(s => s.job_id === j.id); return { ...j, e: js.reduce((s, x) => s + calcEarnings(x, jobs), 0), h: js.reduce((s, x) => s + calcDur(x), 0), n: js.length }; }).filter(j => j.n > 0).sort((a, b) => b.e - a.e);
  const be = employees.map(e => { const es = f.filter(s => s.employee_id === e.id); const hrs = es.reduce((s, x) => s + calcDur(x), 0) / 3600000; return { ...e, hrs, cost: hrs * e.rate, n: es.length }; }).filter(e => e.n > 0).sort((a, b) => b.hrs - a.hrs);

  // Overtime calculations
  const ot = calcOvertime(f);
  const otDays = Object.values(ot.daily).filter(d => d.overtime > 0);
  const otWeeks = Object.values(ot.weekly).filter(w => w.overtime > 0);
  const totalDailyOT = otDays.reduce((s, d) => s + d.overtime, 0);
  const totalWeeklyOT = otWeeks.reduce((s, w) => s + w.overtime, 0);
  const hasOT = otDays.length > 0 || otWeeks.length > 0;

  // Per-employee overtime
  const empOT = employees.map(e => {
    const es = f.filter(s => s.employee_id === e.id);
    const eot = calcOvertime(es);
    const dailyOT = Object.values(eot.daily).reduce((s, d) => s + d.overtime, 0);
    const weeklyOT = Object.values(eot.weekly).reduce((s, w) => s + w.overtime, 0);
    return { ...e, dailyOT, weeklyOT };
  }).filter(e => e.dailyOT > 0 || e.weeklyOT > 0);

  function exportIIF() {
    const lines = ['!TIMERJOB\tJOBNAME\tTIMEBILLED\tJOBDESC'];
    lines.push('!TIMEACT\tDATE\tJOBNAME\tEMP\tSERVICEITEM\tDURATION\tDESC\tBILLINGSTATUS');
    f.forEach(s => {
      const j = jobs.find(x => x.id === s.job_id);
      const emp = employees.find(x => x.id === s.employee_id);
      const hrs = (calcDur(s) / 3600000).toFixed(2);
      const d = new Date(s.start_time);
      lines.push(`TIMEACT\t${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}\t${j?.name || ''}\t${emp?.name || 'Owner'}\tServices\t${hrs}\t\t1`);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    a.download = 'site-ledger-quickbooks.iif';
    a.click();
  }

  function exportCSV() {
    const rows = [['Date', 'Job', 'Employee', 'Start', 'End', 'Hours', 'Earnings (CAD)']];
    f.forEach(s => {
      const j = jobs.find(x => x.id === s.job_id);
      const emp = employees.find(x => x.id === s.employee_id);
      rows.push([new Date(s.start_time).toLocaleDateString('en-CA'), j?.name || '', emp?.name || 'Owner', new Date(s.start_time).toLocaleTimeString('en-CA'), new Date(s.end_time).toLocaleTimeString('en-CA'), (calcDur(s) / 3600000).toFixed(2), calcEarnings(s, jobs).toFixed(2)]);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'site-ledger-report.csv';
    a.click();
  }

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      {showInvoice && (
        <InvoiceModal
          sessions={f} jobs={jobs} employees={employees} customers={customers}
          dateRange={[rs, re]} company={company} onClose={() => setShowInvoice(false)}
        />
      )}

      <div style={{ display: 'flex', gap: 6, padding: '16px 16px 0', flexWrap: 'wrap' }}>
        {[{ id: 'week', l: '7 Days' }, { id: 'month', l: 'This Month' }, { id: 'lastmonth', l: 'Last Month' }, { id: 'year', l: 'This Year' }, { id: 'custom', l: 'Custom' }].map(p => (
          <button key={p.id} onClick={() => setPre(p.id)}
            style={{ padding: '8px 14px', borderRadius: 20, border: pre === p.id ? 'none' : '1px solid #e0e0e0', background: pre === p.id ? '#E8651A' : '#fff', color: pre === p.id ? '#fff' : '#888', fontSize: 13, fontWeight: pre === p.id ? 700 : 400, cursor: 'pointer' }}>
            {p.l}
          </button>
        ))}
      </div>

      {pre === 'custom' && (
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
          <input type="date" value={cs} onChange={e => setCs(e.target.value)} style={{ ...inp, flex: 1 }} />
          <input type="date" value={ce} onChange={e => setCe(e.target.value)} style={{ ...inp, flex: 1 }} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 16px 0' }}>
        <div style={{ ...card, padding: '16px 18px' }}><div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Earned</div><div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#E8651A' }}>{fmtCAD(te)}</div></div>
        <div style={{ ...card, padding: '16px 18px' }}><div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Hours</div><div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{fmtDur(tm)}</div></div>
        <div style={{ ...card, padding: '16px 18px' }}><div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Mileage</div><div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{totalKm.toFixed(0)} km</div></div>
        <div style={{ ...card, padding: '16px 18px' }}><div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>KM Deduction</div><div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#3BB273' }}>{fmtCAD(totalKm * CRA_RATE)}</div></div>
      </div>

      {/* Overtime section */}
      {hasOT && (
        <div style={{ ...card, margin: '16px 16px 0', padding: '20px 24px', border: '1px solid #FDEBD0' }}>
          <div style={{ color: '#E67E22', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>!</span> Overtime Flagged
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ color: '#aaa', fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', marginBottom: 4 }}>Daily OT Days</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#E67E22' }}>{otDays.length}</div>
            </div>
            <div>
              <div style={{ color: '#aaa', fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', marginBottom: 4 }}>Weekly OT</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#E67E22' }}>{otWeeks.length} wk{otWeeks.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div style={{ marginBottom: empOT.length > 0 ? 16 : 0 }}>
            <div style={{ color: '#aaa', fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', marginBottom: 4 }}>Total OT Hrs</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#C0392B' }}>{(totalDailyOT + totalWeeklyOT).toFixed(1)}</div>
          </div>
          {empOT.length > 0 && (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
              {empOT.map(e => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ color: '#333', fontSize: 13 }}>{e.name}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {e.dailyOT > 0 && (
                      <span style={{ background: '#FDEBD0', color: '#E67E22', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, fontFamily: "'DM Mono', monospace" }}>
                        {e.dailyOT.toFixed(1)}h daily
                      </span>
                    )}
                    {e.weeklyOT > 0 && (
                      <span style={{ background: '#FADBD8', color: '#C0392B', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, fontFamily: "'DM Mono', monospace" }}>
                        {e.weeklyOT.toFixed(1)}h weekly
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {bj.length > 0 && (
        <div style={{ ...card, margin: '16px 16px 0', padding: '20px 24px' }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>By Job</div>
          {bj.map(j => {
            const pct = te ? (j.e / te) * 100 : 0;
            return (
              <div key={j.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: j.color }} />
                    <span style={{ color: '#333', fontSize: 13 }}>{j.name}</span>
                  </div>
                  <div>
                    <span style={{ color: '#111', fontSize: 13, fontWeight: 600 }}>{fmtCAD(j.e)}</span>
                    <span style={{ color: '#bbb', fontSize: 12, marginLeft: 8 }}>{fmtDur(j.h)}</span>
                  </div>
                </div>
                <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: j.color, borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {be.length > 0 && (
        <div style={{ ...card, margin: '12px 16px 0', padding: '20px 24px' }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>Crew Hours</div>
          {be.map(e => {
            const eOT = empOT.find(x => x.id === e.id);
            return (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="user" size={14} /></div>
                  <div>
                    <div style={{ color: '#333', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {e.name}
                      {eOT && <span style={{ background: '#FDEBD0', color: '#E67E22', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>OT</span>}
                    </div>
                    <div style={{ color: '#aaa', fontSize: 12 }}>{e.hrs.toFixed(1)} hrs</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#111', fontSize: 13, fontWeight: 600 }}>{fmtCAD(e.cost)}</div>
                  <div style={{ color: '#bbb', fontSize: 11 }}>{fmtCAD(e.rate)}/hr</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {f.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb' }}>No sessions in this period</div>}

      {f.length > 0 && (
        <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => setShowInvoice(true)}
            style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: '#E8651A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <Icon name="dl" size={16} /> Generate Invoice (PDF)
          </button>
          <button onClick={exportCSV} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px solid #e0e0e0', background: '#fff', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="dl" size={14} /> Export CSV
          </button>
          <button onClick={exportIIF} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px solid #2E86AB44', background: '#2E86AB11', color: '#2E86AB', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="qb" size={14} /> Export for QuickBooks (.IIF)
          </button>
        </div>
      )}
    </div>
  );
}
