import { useState, useEffect, useMemo } from 'react';
import SessionModal from '../components/SessionModal.jsx';
import VoiceEntryModal from '../components/VoiceEntryModal.jsx';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { fmtDur } from '../lib/utils.js';
import { fmtCAD, sessionBilling, summarize, currentRates, toCents } from '../lib/billing.js';
import { localDateKey, toLocalInputValue } from '../lib/time.js';
import { computeOvertime, workerKey } from '../lib/overtime.js';

const SyncDot = ({ s }) => (s && s !== 'synced'
  ? <span title={s === 'error' || s === 'conflict' ? 'Needs attention' : 'Saved on this device, not synced yet'} aria-label={s === 'error' || s === 'conflict' ? 'Needs attention' : 'Not synced yet'} role="img"
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginLeft: 6, background: s === 'error' || s === 'conflict' ? '#c0392b' : '#E67E22' }} />
  : null);

export default function ClockTab({ jobs, employees, sessions, company, active, openSessions = [], onIn, onOut, onPause, onResume, onSave, onDelete, onVoiceProcess, onVoiceInvoice, online, breakState, otRules, isDesktop }) {
  const activeJobs = jobs.filter(j => (j.status || 'active') === 'active');
  const [selJob, setSelJob] = useState(activeJobs[0]?.id || '');
  const [selEmp, setSelEmp] = useState('');
  const [now, setNow] = useState(Date.now());
  const [editSess, setEditSess] = useState(null);
  const [showVoice, setShowVoice] = useState(false);
  const [voiceDrafts, setVoiceDrafts] = useState([]);
  const [staleEndTime, setStaleEndTime] = useState('');
  const [dayType, setDayType] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (activeJobs.length && !activeJobs.some(j => j.id === selJob)) setSelJob(activeJobs[0].id); }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDayType(active?.day_type || ''); }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isStale = !!active && localDateKey(active.start_time) !== localDateKey(now);
  useEffect(() => {
    if (isStale && active && !staleEndTime) {
      const d = new Date(active.start_time);
      const fivePm = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0);
      setStaleEndTime(toLocalInputValue(fivePm > d ? fivePm : new Date(d.getTime() + 3600000)));
    }
    if (!active) setStaleEndTime('');
  }, [active?.id, isStale]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (p) => { if (busy) return null; setBusy(true); try { return await p(); } finally { setBusy(false); } };

  const data = { jobs, employees, company };
  const aJob = jobs.find(j => j.id === active?.job_id);
  const isPaused = !!breakState?.pausedAt;
  const effectiveNow = isPaused ? breakState.pausedAt : now;
  const elapsed = active ? Math.max(0, effectiveNow - new Date(active.start_time) - (breakState?.totalBreakMs || 0)) : 0;
  const currentBreakMs = isPaused ? now - breakState.pausedAt : 0;
  const todayKey = localDateKey(now);
  const today = sessions.filter(s => localDateKey(s.start_time) === todayKey);
  const todayRevenue = summarize(today, data).revenueCents;
  const todayMs = today.reduce((s, x) => s + (Date.parse(x.end_time) - Date.parse(x.start_time) - (x.break_seconds || 0) * 1000), 0);

  // Daily overtime for the worker who is clocked in (or the owner).
  const dailyOT = useMemo(() => {
    if (!otRules?.enabled) return 0;
    const worker = active ? workerKey(active) : 'owner';
    const mine = today.filter(s => workerKey(s) === worker);
    const live = active && !isStale ? [{ ...active, end_time: new Date(active.start_time).getTime() + elapsed + (breakState?.totalBreakMs || 0) }] : [];
    const d = computeOvertime([...mine, ...live.map(s => ({ ...s, end_time: new Date(s.end_time).toISOString() }))], otRules)[worker]?.days[todayKey];
    return d ? d.ot + d.double : 0;
  }, [today, active, elapsed, isStale, otRules, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveEstimate = (() => {
    if (!aJob || aJob.pricing_type === 'fixed') return null;
    const rate = active.bill_rate ?? currentRates({ job: aJob, company }).bill_rate;
    return Math.round((elapsed / 3600000) * toCents(rate));
  })();
  const voiceDraft = voiceDrafts[0] || null;
  const voiceDraftCount = voiceDrafts.length;
  const empName = id => employees.find(e => e.id === id)?.name;

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      {editSess && (
        <SessionModal session={editSess} jobs={jobs} employees={employees} company={company}
          onSave={onSave} onSaved={() => setEditSess(null)} onClose={() => setEditSess(null)} />
      )}
      {showVoice && (
        <VoiceEntryModal
          jobs={activeJobs}
          online={online}
          onProcess={onVoiceProcess}
          onDraft={draft => {
            setShowVoice(false);
            if (draft.intent === 'invoice_request' && onVoiceInvoice) { onVoiceInvoice(draft.invoice_request || {}); return; }
            const entries = Array.isArray(draft.entries) && draft.entries.length ? draft.entries : [draft];
            const validJob = id => activeJobs.some(j => j.id === id);
            setVoiceDrafts(entries.map((entry, index) => {
              const sess = { ...(entry.session || {}) };
              const warnings = [...(entry.warnings || [])];
              if (sess.job_id && !validJob(sess.job_id)) { sess.job_id = null; warnings.push('The suggested job was not recognised. Choose the job.'); }
              return { ...entry, session: sess, warnings, draftId: `${Date.now()}-${index}` };
            }));
          }}
          onClose={() => setShowVoice(false)}
        />
      )}
      {voiceDraft && (
        <SessionModal
          key={voiceDraft.draftId}
          initialSession={voiceDraft.session}
          voiceMeta={{
            transcript: voiceDraft.transcript,
            assumptions: voiceDraft.assumptions,
            warnings: voiceDraftCount > 1 ? [`Reviewing ${voiceDraftCount} voice drafts. Save this one to continue to the next.`, ...(voiceDraft.warnings || [])] : voiceDraft.warnings,
            confidence: voiceDraft.confidence,
          }}
          jobs={jobs} employees={employees} company={company}
          onSave={s => {
            const sStart = Date.parse(s.start_time);
            const sEnd = Date.parse(s.end_time);
            const overlap = sessions.find(ex => (ex.employee_id || null) === (s.employee_id || null) && sStart < Date.parse(ex.end_time) && sEnd > Date.parse(ex.start_time));
            if (overlap) {
              const j = jobs.find(x => x.id === overlap.job_id);
              if (!window.confirm(`This overlaps an existing ${j?.name || 'entry'} for the same person. Save anyway?`)) return Promise.resolve({ ok: false, error: 'Not saved.' });
            }
            return onSave(s);
          }}
          onSaved={() => setVoiceDrafts(prev => prev.slice(1))}
          onClose={() => {
            if (voiceDraftCount > 1 && !window.confirm(`Discard ${voiceDraftCount} remaining voice drafts?`)) return;
            setVoiceDrafts([]);
          }}
        />
      )}

      <section style={{ ...card, padding: '16px 20px', margin: '16px 16px 0' }} aria-label="Today">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#777', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase' }}>Today</div>
          {dailyOT > 0 && (
            <div title="Daily overtime flag for this worker (BC rules). Not a payroll calculation." style={{ background: dailyOT > 4 ? '#FADBD8' : '#FDEBD0', color: dailyOT > 4 ? '#A93226' : '#A35A10', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, fontFamily: "'DM Mono', monospace" }}>
              {dailyOT.toFixed(1)}h OT
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', lineHeight: 1 }}>{fmtCAD(todayRevenue)}</div>
            <div style={{ color: '#777', fontSize: 12, marginTop: 4 }}>billable</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', lineHeight: 1 }}>{fmtDur(todayMs)}</div>
            <div style={{ color: '#777', fontSize: 12, marginTop: 4 }}>logged</div>
          </div>
        </div>
      </section>

      <div style={{ margin: '12px 16px 0' }}>
        <button type="button" onClick={() => setShowVoice(true)} disabled={busy}
          style={{ width: '100%', padding: '13px 16px', borderRadius: 12, border: '1.5px solid #e0e0e0', background: '#fff', color: '#333', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="mic" size={16} /> Voice Entry
        </button>
      </div>

      {openSessions.length > 1 && (
        <div role="alert" style={{ margin: '12px 16px 0', background: '#fff8f0', border: '1px solid #f0c070', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#7a4a10' }}>
          {openSessions.length} sessions are clocked in (probably from another device). Showing the most recent; the others are listed under Recent with no end time — edit or delete them there.
        </div>
      )}

      {active && (
        <section aria-label="Active session" style={{ background: isPaused ? '#fff9f0' : `linear-gradient(135deg,${aJob?.color}22,${aJob?.color}11)`, border: isPaused ? '1px solid #f0c070' : `1px solid ${aJob?.color}44`, borderRadius: 16, margin: '12px 16px 0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {isPaused
              ? <><Icon name="pause" size={10} /><span style={{ color: '#8a5a00', fontSize: 12, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>ON BREAK</span></>
              : <><div style={{ width: 8, height: 8, borderRadius: '50%', background: aJob?.color }} /><span style={{ color: '#666', fontSize: 12, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>ACTIVE</span></>}
            <SyncDot s={active._sync} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', marginBottom: 4 }}>{aJob?.name}{active.employee_id ? <span style={{ fontSize: 14, color: '#666', fontWeight: 400 }}> · {empName(active.employee_id)}</span> : null}</div>
          <div aria-live="off" style={{ fontSize: 36, fontFamily: "'DM Mono', monospace", color: isPaused ? '#888' : aJob?.color, fontWeight: 600 }}>{fmtDur(elapsed)}</div>
          {isPaused
            ? <div style={{ color: '#8a5a00', fontSize: 13, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>break {fmtDur(currentBreakMs)}</div>
            : aJob?.pricing_type === 'fixed'
              ? <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>Fixed price — pick Half or Full Day when you clock out</div>
              : liveEstimate != null && <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>≈ {fmtCAD(liveEstimate)} billable so far</div>}
          {breakState?.totalBreakMs > 0 && !isPaused && <div style={{ color: '#777', fontSize: 12, marginTop: 2 }}>{fmtDur(breakState.totalBreakMs)} break taken</div>}
        </section>
      )}

      {isStale && (
        <section aria-label="Forgot to clock out" style={{ margin: '12px 16px 0', background: '#fff8f0', border: '1.5px solid #f0c070', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a35a10', fontFamily: "'DM Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>FORGOT TO CLOCK OUT?</div>
          <label htmlFor="stale-end" style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 12 }}>
            This session started {new Date(active.start_time).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(active.start_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}. Set your actual clock-out time:
          </label>
          <input id="stale-end" type="datetime-local" value={staleEndTime} onChange={e => setStaleEndTime(e.target.value)}
            min={toLocalInputValue(active.start_time)} max={toLocalInputValue(now)} style={{ ...inp, marginBottom: 10 }} />
          {aJob?.pricing_type === 'fixed' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['half', 'full'].map(d => (
                <button key={d} type="button" onClick={() => setDayType(d)} aria-pressed={dayType === d}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: dayType === d ? (aJob.color || '#E67E22') : '#f0f0f0', color: dayType === d ? '#fff' : '#555' }}>
                  {d === 'half' ? 'Half Day' : 'Full Day'}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => act(() => onOut(new Date(staleEndTime).toISOString(), dayType || null))} disabled={!staleEndTime || busy || (aJob?.pricing_type === 'fixed' && !dayType)}
              style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: '#B9601A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: !staleEndTime || busy || (aJob?.pricing_type === 'fixed' && !dayType) ? 0.5 : 1 }}>
              {busy ? 'Saving...' : 'Save Clock-Out'}
            </button>
            <button type="button" aria-label="Delete this session" onClick={() => { if (window.confirm('Delete this session?')) act(() => onDelete(active.id)); }}
              style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #f0c0c0', background: '#fde8e8', color: '#a93226', fontSize: 13, cursor: 'pointer' }}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        </section>
      )}

      <div style={{ ...card, margin: '12px 16px 0', padding: '16px 20px' }}>
        {!active ? (
          <>
            <div style={lbl} id="job-pick-label">Select Job</div>
            {activeJobs.length === 0 && <div style={{ color: '#777', fontSize: 13, padding: '8px 0 16px' }}>No active jobs — add one in the Jobs tab.</div>}
            <div role="group" aria-labelledby="job-pick-label" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: employees.length > 0 ? 12 : 16 }}>
              {activeJobs.map(j => (
                <button key={j.id} type="button" onClick={() => setSelJob(j.id)} aria-pressed={selJob === j.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, border: selJob === j.id ? `1.5px solid ${j.color}` : '1.5px solid #e8e8e8', background: selJob === j.id ? `${j.color}15` : '#fafafa', cursor: 'pointer' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{j.name}</div>
                    <div style={{ color: '#777', fontSize: 12 }}>{j.pricing_type === 'fixed' ? 'Fixed price' : `${fmtCAD(toCents(j.rate))}/hr`}</div>
                  </div>
                  {selJob === j.id && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
            {employees.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="clock-emp" style={lbl}>Who is working</label>
                <select id="clock-emp" value={selEmp} onChange={e => setSelEmp(e.target.value)} style={inp}>
                  <option value="">Me (owner)</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            )}
            <button type="button" onClick={() => act(() => onIn(selJob, selEmp || null))} disabled={!selJob || busy || activeJobs.length === 0}
              style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: selJob && activeJobs.length ? activeJobs.find(j => j.id === selJob)?.color || '#E8651A' : '#e0e0e0', color: selJob && activeJobs.length ? '#fff' : '#777', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? '...' : 'Clock In'}
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!isStale && (isPaused
              ? <button type="button" onClick={() => act(onResume)} disabled={busy}
                  style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: aJob?.color || '#E8651A', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Icon name="play" size={15} /> Resume
                </button>
              : <button type="button" onClick={() => act(onPause)} disabled={busy}
                  style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #ddd', background: '#f8f8f8', color: '#444', fontSize: 14, fontWeight: 600, fontFamily: "'Syne', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Icon name="pause" size={14} /> Take a Break
                </button>
            )}
            {!isStale && aJob?.pricing_type === 'fixed' && (
              <div role="group" aria-label="Day type" style={{ display: 'flex', gap: 8 }}>
                {['half', 'full'].map(d => (
                  <button key={d} type="button" onClick={() => setDayType(d)} aria-pressed={dayType === d}
                    style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: dayType === d ? (aJob.color || '#E8651A') : '#f0f0f0', color: dayType === d ? '#fff' : '#555' }}>
                    {d === 'half' ? 'Half Day' : 'Full Day'}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => act(() => onOut(null, dayType || null))} disabled={busy || (!isStale && aJob?.pricing_type === 'fixed' && !dayType)}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: '2px solid #e8c6c6', background: '#fde8e8', color: '#a93226', fontSize: 15, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: 'pointer', opacity: busy || (!isStale && aJob?.pricing_type === 'fixed' && !dayType) ? 0.6 : 1 }}>
              {busy ? 'Saving...' : isStale ? 'Clock Out Now' : 'Clock Out'}
            </button>
          </div>
        )}
      </div>

      {(sessions.length > 0 || openSessions.length > 1) && (
        <section aria-label="Recent entries" style={{ margin: '20px 16px 0' }}>
          <div style={{ color: '#777', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Recent</div>
          {[...openSessions.slice(1), ...[...sessions].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time)).slice(0, 8)].map(s => {
            const j = jobs.find(x => x.id === s.job_id);
            const emp = employees.find(x => x.id === s.employee_id);
            const bill = s.end_time ? sessionBilling(s, data) : null;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: j?.color || '#ccc', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>
                    {j?.name || 'Unknown job'}{emp ? <span style={{ color: '#777', fontWeight: 400 }}> · {emp.name}</span> : null}<SyncDot s={s._sync} />
                  </div>
                  <div style={{ color: '#777', fontSize: 12 }}>{new Date(s.start_time).toLocaleDateString('en-CA')} · {s.end_time ? fmtDur(Date.parse(s.end_time) - Date.parse(s.start_time) - (s.break_seconds || 0) * 1000) : 'still clocked in'}</div>
                  {s.notes && <div style={{ color: '#888', fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.notes}</div>}
                </div>
                <div style={{ textAlign: 'right', marginRight: 4 }}>
                  {bill && <div style={{ color: '#111', fontSize: 13, fontWeight: 600 }}>{fmtCAD(bill.amountCents)}</div>}
                  {bill?.missing === 'day_type' && <div style={{ color: '#a93226', fontSize: 11 }}>pick day type</div>}
                </div>
                <button type="button" aria-label="Edit entry" onClick={() => setEditSess(s)} style={{ ...ib, padding: 8 }}><Icon name="edit" size={14} /></button>
                <button type="button" aria-label="Delete entry" onClick={() => { if (window.confirm(s.invoice_id ? 'This entry is already billed. Deleting it won\'t change the recorded invoice or any invoice already sent. Delete anyway?' : 'Delete this entry?')) onDelete(s.id); }} style={{ ...ib, color: '#c0392b', padding: 8 }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
