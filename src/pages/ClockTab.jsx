import { useState, useEffect } from 'react';
import SessionModal from '../components/SessionModal.jsx';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { fmtDur, fmtCAD, calcEarnings, calcDur } from '../lib/utils.js';

export default function ClockTab({ jobs, employees, sessions, active, onIn, onOut, onSave, onDelete, busy, isDesktop }) {
  const activeJobs = jobs.filter(j => (j.status || 'active') === 'active');
  const [selJob, setSelJob] = useState(activeJobs[0]?.id || '');
  const [selEmp, setSelEmp] = useState('');
  const [now, setNow] = useState(Date.now());
  const [editSess, setEditSess] = useState(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (activeJobs.length && !selJob) setSelJob(activeJobs[0].id); }, [jobs]);

  const aJob = jobs.find(j => j.id === active?.job_id);
  const elapsed = active ? now - new Date(active.start_time) : 0;
  const today = sessions.filter(s => new Date(s.start_time).toDateString() === new Date().toDateString());
  const todayEarn = today.reduce((s, x) => s + calcEarnings(x, jobs), 0);
  const todayMs = today.reduce((s, x) => s + calcDur(x), 0);
  const todayHrs = (todayMs + elapsed) / 3600000;
  const dailyOT = Math.max(0, todayHrs - 8);

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      {editSess && (
        <SessionModal session={editSess} jobs={jobs} employees={employees}
          onSave={s => { onSave(s); setEditSess(null); }}
          onClose={() => setEditSess(null)} busy={busy} />
      )}

      <div style={{ ...card, padding: '16px 20px', margin: '16px 16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase' }}>Today</div>
          {dailyOT > 0 && (
            <div style={{ background: dailyOT > 4 ? '#FADBD8' : '#FDEBD0', color: dailyOT > 4 ? '#C0392B' : '#E67E22', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, fontFamily: "'DM Mono', monospace" }}>
              {dailyOT.toFixed(1)}h OT
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', lineHeight: 1 }}>{fmtCAD(todayEarn)}</div>
            <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>earned</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', lineHeight: 1 }}>{fmtDur(todayMs)}</div>
            <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>logged</div>
          </div>
        </div>
      </div>

      {active && (
        <div style={{ background: `linear-gradient(135deg,${aJob?.color}22,${aJob?.color}11)`, border: `1px solid ${aJob?.color}44`, borderRadius: 16, margin: '12px 16px 0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: aJob?.color, boxShadow: `0 0 8px ${aJob?.color}` }} />
            <span style={{ color: '#888', fontSize: 12, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>ACTIVE</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', marginBottom: 4 }}>{aJob?.name}</div>
          <div style={{ fontSize: 36, fontFamily: "'DM Mono', monospace", color: aJob?.color, fontWeight: 600 }}>{fmtDur(elapsed)}</div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>≈ {fmtCAD((elapsed / 3600000) * (aJob?.rate || 0))}</div>
        </div>
      )}

      <div style={{ ...card, margin: '12px 16px 0', padding: '16px 20px' }}>
        {!active ? (
          <>
            <label style={lbl}>Select Job</label>
            {activeJobs.length === 0 && <div style={{ color: '#aaa', fontSize: 13, padding: '8px 0 16px' }}>No active jobs — add one in the Jobs tab.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: employees.length > 0 ? 12 : 16 }}>
              {activeJobs.map(j => (
                <button key={j.id} onClick={() => setSelJob(j.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, border: selJob === j.id ? `1.5px solid ${j.color}` : '1.5px solid #e8e8e8', background: selJob === j.id ? `${j.color}15` : '#fafafa', cursor: 'pointer' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{j.name}</div>
                    <div style={{ color: '#999', fontSize: 12 }}>{fmtCAD(j.rate)}/hr</div>
                  </div>
                  {selJob === j.id && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
            {employees.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Employee (optional)</label>
                <select value={selEmp} onChange={e => setSelEmp(e.target.value)} style={inp}>
                  <option value="">— Me (owner) —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => onIn(selJob, selEmp || null)} disabled={!selJob || busy || activeJobs.length === 0}
              style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: selJob && activeJobs.length ? activeJobs.find(j => j.id === selJob)?.color || '#E8651A' : '#e8e8e8', color: selJob && activeJobs.length ? '#fff' : '#aaa', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? '...' : 'Clock In'}
            </button>
          </>
        ) : (
          <button onClick={onOut} disabled={busy}
            style={{ width: '100%', padding: '16px', borderRadius: 12, border: '2px solid #e8c6c6', background: '#fde8e8', color: '#c0392b', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Saving...' : 'Clock Out'}
          </button>
        )}
      </div>

      {sessions.length > 0 && (
        <div style={{ margin: '20px 16px 0' }}>
          <div style={{ color: '#bbb', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Recent</div>
          {[...sessions].reverse().slice(0, 8).map(s => {
            const j = jobs.find(x => x.id === s.job_id);
            const emp = employees.find(x => x.id === s.employee_id);
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: j?.color || '#ccc', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>
                    {j?.name || 'Unknown'}{emp ? <span style={{ color: '#aaa', fontWeight: 400 }}> · {emp.name}</span> : null}
                  </div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>{new Date(s.start_time).toLocaleDateString('en-CA')} · {fmtDur(calcDur(s))}</div>
                </div>
                <div style={{ color: '#111', fontSize: 13, fontWeight: 600, marginRight: 4 }}>{fmtCAD(calcEarnings(s, jobs))}</div>
                <button onClick={() => setEditSess(s)} style={ib}><Icon name="edit" size={14} /></button>
                <button onClick={() => { if (confirm('Delete this entry?')) onDelete(s.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
