import { useState, useMemo } from 'react';
import SessionModal from '../components/SessionModal.jsx';
import Icon from '../components/Icon.jsx';
import { card, ib } from '../styles.js';
import { MN } from '../lib/constants.js';
import { fmtDur, calcDur, dayKey } from '../lib/utils.js';
import { fmtCAD, sessionBilling, sessionLabourCents, summarize } from '../lib/billing.js';
import { computeOvertime } from '../lib/overtime.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function CalendarTab({ jobs, employees, sessions, company, invoices = [], otRules, onSave, onDelete, isDesktop }) {
  const accent = useAccentColor();
  const [vd, setVd] = useState(new Date());
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const yr = vd.getFullYear();
  const mo = vd.getMonth();
  const fd = new Date(yr, mo, 1).getDay();
  const dim = new Date(yr, mo + 1, 0).getDate();

  const byDay = useMemo(() => {
    const m = {};
    sessions.forEach(s => { const k = dayKey(s.start_time); if (!m[k]) m[k] = []; m[k].push(s); });
    return m;
  }, [sessions]);

  function dk(d) { return `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

  // Daily overtime flags per worker; a day is flagged if any one worker is over.
  const otByDay = useMemo(() => {
    if (!otRules?.enabled) return {};
    const out = {};
    for (const bw of Object.values(computeOvertime(sessions, otRules))) {
      for (const [day, d] of Object.entries(bw.days)) {
        const over = d.ot + d.double;
        if (over > 0) out[day] = Math.max(out[day] || 0, over);
      }
    }
    return out;
  }, [sessions, otRules]);
  const data = { jobs, employees, company };

  const ss = sel ? (byDay[dk(sel)] || []) : [];
  const selSum = summarize(ss, data);
  const selMs = ss.reduce((s, x) => s + calcDur(x), 0);
  const selOT = sel ? otByDay[dk(sel)] || 0 : 0;
  const modalDate = sel ? new Date(yr, mo, sel) : new Date();

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      {tooltip && (
        <div style={{ position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 14, background: '#111', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 12, pointerEvents: 'none', zIndex: 1000, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', lineHeight: 1.6 }}>
          {tooltip.jobs.map((j, i) => <div key={i}>{j}</div>)}
          <div style={{ color: '#aaa', marginTop: 2, fontSize: 11 }}>{fmtDur(tooltip.ms)}</div>
        </div>
      )}
      {modal && (
        <SessionModal
          session={modal === 'add' ? null : modal}
          date={modal === 'add' ? modalDate : null}
          jobs={jobs} employees={employees} company={company}
          onSave={onSave} onSaved={() => setModal(null)}
          onClose={() => setModal(null)} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
        <button type="button" aria-label="Previous month" onClick={() => { setVd(new Date(yr, mo - 1)); setSel(null); }} style={{ ...ib, color: '#666', padding: 10 }}><Icon name="cl" size={16} /></button>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{MN[mo]} {yr}</div>
        <button type="button" aria-label="Next month" onClick={() => { setVd(new Date(yr, mo + 1)); setSel(null); }} style={{ ...ib, color: '#666', padding: 10 }}><Icon name="cr" size={16} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 16px', gap: 2, marginBottom: 4 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', color: '#dc3333', fontSize: 11, fontFamily: "'DM Mono', monospace", padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 16px', gap: 3 }}>
        {Array.from({ length: fd }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: dim }).map((_, i) => {
          const d = i + 1, k = dk(d), ds = byDay[k] || [];
          const isTd = new Date().getDate() === d && new Date().getMonth() === mo && new Date().getFullYear() === yr;
          const isSel = sel === d;
          const cols = [...new Set(ds.map(s => jobs.find(j => j.id === s.job_id)?.color).filter(Boolean))];
          const hasOT = (otByDay[k] || 0) > 0;
          const hasUnbilled = ds.some(s => s.end_time && !s.invoice_id);
          return (
            <button key={d} type="button" onClick={() => setSel(isSel ? null : d)} aria-pressed={isSel}
              aria-label={`${MN[mo]} ${d}${ds.length ? `, ${ds.length} entr${ds.length === 1 ? 'y' : 'ies'}` : ''}${hasUnbilled ? ', not yet billed' : ''}${hasOT ? ', overtime' : ''}`}
              onMouseEnter={ds.length > 0 ? e => {
                const jobNames = [...new Set(ds.map(s => jobs.find(j => j.id === s.job_id)?.name).filter(Boolean))];
                const ms = ds.reduce((s, x) => s + calcDur(x), 0);
                setTooltip({ x: e.clientX, y: e.clientY, jobs: jobNames, ms });
              } : undefined}
              onMouseLeave={ds.length > 0 ? () => setTooltip(null) : undefined}
              style={{ aspectRatio: '1', borderRadius: 10, border: isSel ? `1.5px solid ${accent}` : hasOT ? '1.5px solid #E67E22' : isTd ? '1.5px solid #ccc' : '1.5px solid transparent', background: isSel ? `${accent}22` : hasOT ? '#FEF5E7' : isTd ? '#f0f0f0' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4 }}>
              <span style={{ position: 'relative', color: hasOT ? '#E67E22' : isTd ? accent : ds.length ? '#111' : '#bbb', fontSize: 13, fontWeight: isTd || hasOT ? 700 : 400 }}>
                {d}
                {hasUnbilled && (
                  <span title="Not yet billed" style={{ position: 'absolute', top: -1, right: -7, width: 6, height: 6, borderRadius: '50%', background: '#dc3333' }} />
                )}
              </span>
              {cols.length > 0 && (
                <div style={{ display: 'flex', gap: 2 }}>
                  {cols.slice(0, 3).map((c, ci) => <div key={ci} style={{ width: 5, height: 5, borderRadius: '50%', background: c }} />)}
                  {hasOT && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#E67E22' }} />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {Object.values(byDay).some(ds => ds.some(s => s.end_time && !s.invoice_id)) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px 0', color: '#999', fontSize: 11 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc3333' }} /> Not yet billed
        </div>
      )}

      {sel && (
        <div style={{ ...card, margin: '16px 16px 0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ color: '#111', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>{MN[mo]} {sel}</div>
              {ss.length > 0 && (
                <div style={{ color: '#999', fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {fmtDur(selMs)} · {fmtCAD(selSum.revenueCents)} billable
                  {selSum.labourCents > 0 && (
                    <span title="Billable minus employee wages for this day" style={{ background: '#eafaf1', color: '#1e6b3a', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, fontFamily: "'DM Mono', monospace" }}>
                      {fmtCAD(selSum.revenueCents - selSum.labourCents)} after wages
                    </span>
                  )}
                  {selOT > 0 && (
                    <span title="Daily overtime flag for at least one worker (BC rules)" style={{ background: selOT > 4 ? '#FADBD8' : '#FDEBD0', color: selOT > 4 ? '#A93226' : '#A35A10', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, fontFamily: "'DM Mono', monospace" }}>
                      {selOT.toFixed(1)}h OT
                    </span>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => setModal('add')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="plus" size={14} /> Add
            </button>
          </div>
          {ss.length === 0 ? (
            <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              No entries. <span onClick={() => setModal('add')} style={{ color: accent, cursor: 'pointer', textDecoration: 'underline' }}>Add one.</span>
            </div>
          ) : ss.map(s => {
            const j = jobs.find(x => x.id === s.job_id);
            const emp = employees.find(x => x.id === s.employee_id);
            return (
              <div key={s.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0', alignItems: 'center' }}>
                <div style={{ width: 3, borderRadius: 2, background: j?.color, flexShrink: 0, alignSelf: 'stretch' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>
                    {j?.name}{emp ? <span style={{ color: '#aaa', fontWeight: 400 }}> · {emp.name}</span> : null}
                  </div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>
                    {new Date(s.start_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })} –{' '}
                    {new Date(s.end_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })} · {fmtDur(calcDur(s))}
                  </div>
                  {s.invoice_id && (
                    <div style={{ display: 'inline-block', marginTop: 3, padding: '1px 7px', borderRadius: 10, background: '#EBF5FB', color: '#2E86AB', fontSize: 10, fontWeight: 700 }}>
                      Billed{(() => { const inv = invoices.find(x => x.id === s.invoice_id); return inv?.notes ? ` · ${inv.notes}` : ''; })()}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', marginRight: 4 }}>
                  {(() => {
                    const bill = sessionBilling(s, data);
                    const labour = sessionLabourCents(s, data);
                    return <>
                      <div style={{ color: '#111', fontSize: 13, fontWeight: 600 }}>{fmtCAD(bill.amountCents)}</div>
                      {emp && <div style={{ color: '#666', fontSize: 11 }}>wage {fmtCAD(labour)}</div>}
                      {bill.missing === 'day_type' && <div style={{ color: '#a93226', fontSize: 11 }}>pick day type</div>}
                    </>;
                  })()}
                </div>
                <button type="button" aria-label="Edit entry" onClick={() => setModal(s)} style={{ ...ib, padding: 8 }}><Icon name="edit" size={14} /></button>
                <button type="button" aria-label="Delete entry" onClick={() => { if (window.confirm(s.invoice_id ? 'This entry is already billed. Deleting it won\'t change the recorded or QuickBooks invoice. Delete anyway?' : 'Delete this entry?')) onDelete(s.id); }} style={{ ...ib, color: '#c0392b', padding: 8 }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
