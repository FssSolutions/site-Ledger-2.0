import { useState, useMemo } from 'react';
import SessionModal from '../components/SessionModal.jsx';
import Icon from '../components/Icon.jsx';
import { card, ib } from '../styles.js';
import { MN } from '../lib/constants.js';
import { fmtDur, fmtCAD, calcEarnings, calcDur, dayKey } from '../lib/utils.js';

export default function CalendarTab({ jobs, employees, sessions, onSave, onDelete, busy }) {
  const [vd, setVd] = useState(new Date());
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);

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

  const ss = sel ? (byDay[dk(sel)] || []) : [];
  const selEarn = ss.reduce((s, x) => s + calcEarnings(x, jobs), 0);
  const selMs = ss.reduce((s, x) => s + calcDur(x), 0);
  const modalDate = sel ? new Date(yr, mo, sel) : new Date();

  return (
    <div style={{ padding: '0 0 100px' }}>
      {modal && (
        <SessionModal
          session={modal === 'add' ? null : modal}
          date={modal === 'add' ? modalDate : null}
          jobs={jobs} employees={employees}
          onSave={s => { onSave(s, () => setModal(null)); }}
          onClose={() => setModal(null)} busy={busy} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
        <button onClick={() => { setVd(new Date(yr, mo - 1)); setSel(null); }} style={{ ...ib, color: '#888' }}><Icon name="cl" size={16} /></button>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{MN[mo]} {yr}</div>
        <button onClick={() => { setVd(new Date(yr, mo + 1)); setSel(null); }} style={{ ...ib, color: '#888' }}><Icon name="cr" size={16} /></button>
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
          return (
            <button key={d} onClick={() => setSel(isSel ? null : d)}
              style={{ aspectRatio: '1', borderRadius: 10, border: isSel ? '1.5px solid #E8651A' : isTd ? '1.5px solid #ccc' : '1.5px solid transparent', background: isSel ? '#E8651A22' : isTd ? '#f0f0f0' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4 }}>
              <span style={{ color: isTd ? '#E8651A' : ds.length ? '#111' : '#bbb', fontSize: 13, fontWeight: isTd ? 700 : 400 }}>{d}</span>
              {cols.length > 0 && (
                <div style={{ display: 'flex', gap: 2 }}>
                  {cols.slice(0, 3).map((c, ci) => <div key={ci} style={{ width: 5, height: 5, borderRadius: '50%', background: c }} />)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {sel && (
        <div style={{ ...card, margin: '16px 16px 0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ color: '#111', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>{MN[mo]} {sel}</div>
              {ss.length > 0 && <div style={{ color: '#999', fontSize: 12, marginTop: 2 }}>{fmtDur(selMs)} · {fmtCAD(selEarn)}</div>}
            </div>
            <button onClick={() => setModal('add')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: '#E8651A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="plus" size={14} /> Add
            </button>
          </div>
          {ss.length === 0 ? (
            <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              No entries. <span onClick={() => setModal('add')} style={{ color: '#E8651A', cursor: 'pointer', textDecoration: 'underline' }}>Add one.</span>
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
                </div>
                <div style={{ color: '#111', fontSize: 13, fontWeight: 600, marginRight: 4 }}>{fmtCAD(calcEarnings(s, jobs))}</div>
                <button onClick={() => setModal(s)} style={ib}><Icon name="edit" size={14} /></button>
                <button onClick={() => { if (confirm('Delete this entry?')) onDelete(s.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
