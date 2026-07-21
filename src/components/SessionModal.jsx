import { useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import Icon from './Icon.jsx';
import { inp, lbl } from '../styles.js';
import { MN } from '../lib/constants.js';
import { fmtDur, fmtCAD, dayKey, todayStr } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function SessionModal({ session, initialSession, voiceMeta, date, jobs, employees, company, onSave, onClose, busy }) {
  const accent = useAccentColor();
  const draft = session || initialSession || null;
  const isEdit = !!session?.id;
  const defaultDate = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : todayStr();
  const defaultSt = draft?.start_time ? new Date(draft.start_time).toTimeString().slice(0, 5) : '08:00';
  const defaultEt = draft?.end_time ? new Date(draft.end_time).toTimeString().slice(0, 5) : '16:00';
  const [form, setForm] = useState({
    jobId: draft ? draft.job_id || '' : jobs[0]?.id || '',
    empId: draft?.employee_id || '',
    date: draft?.start_time ? dayKey(draft.start_time) : defaultDate,
    st: defaultSt,
    et: defaultEt,
    notes: draft?.notes || '',
    dayType: draft?.day_type || '',
  });

  const startDt = new Date(`${form.date}T${form.st}`);
  const endDt = new Date(`${form.date}T${form.et}`);
  const valid = endDt > startDt;
  const job = jobs.find(j => j.id === form.jobId);
  const isFixed = job?.pricing_type === 'fixed';
  const prevMs = valid ? endDt - startDt : 0;
  const fixedRate = form.dayType === 'half' ? (job?.half_day_rate ?? company?.halfDayRate) : (job?.full_day_rate ?? company?.fullDayRate);
  const prevEarn = valid && job ? (isFixed ? (form.dayType ? Number(fixedRate) || 0 : 0) : (prevMs / 3600000) * job.rate) : 0;
  const prevHrs = prevMs / 3600000;
  const effectiveRate = isFixed && form.dayType && prevHrs ? prevEarn / prevHrs : 0;
  const subtitle = voiceMeta
    ? 'Review voice entry'
    : isEdit
    ? 'Edit entry'
    : date ? `${MN[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : 'New entry';
  const warnings = voiceMeta?.warnings || [];
  const assumptions = voiceMeta?.assumptions || [];
  const confidence = voiceMeta?.confidence || null;

  function confDot(score) {
    if (!confidence || score == null) return null;
    const color = score >= 0.8 ? '#3BB273' : score >= 0.5 ? '#E67E22' : '#C0392B';
    const label = score >= 0.8 ? 'High confidence' : score >= 0.5 ? 'Low confidence — verify' : 'Very low confidence — verify';
    return <span title={label} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, marginLeft: 5, verticalAlign: 'middle' }} />;
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={isEdit ? 'Edit Entry' : 'Add Entry'} subtitle={subtitle} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {voiceMeta && (
          <div style={{ border: '1px solid #f0c070', borderRadius: 12, background: '#fffaf2', padding: '12px 14px' }}>
            <div style={{ color: '#c87020', fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Voice draft</div>
            {warnings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {warnings.map((w, i) => <div key={i} style={{ color: '#8a5a14', fontSize: 12 }}>{w}</div>)}
              </div>
            )}
            {assumptions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {assumptions.map((a, i) => <div key={i} style={{ color: '#777', fontSize: 12 }}>{a}</div>)}
              </div>
            )}
            {voiceMeta.transcript && (
              <details>
                <summary style={{ color: '#777', fontSize: 12, cursor: 'pointer' }}>Transcript</summary>
                <div style={{ color: '#555', fontSize: 12, lineHeight: 1.5, marginTop: 8, whiteSpace: 'pre-wrap' }}>{voiceMeta.transcript}</div>
              </details>
            )}
          </div>
        )}
        <div>
          <label style={lbl}>Job{confDot(confidence?.job)}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map(j => (
              <button key={j.id} onClick={() => setForm({ ...form, jobId: j.id })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, border: form.jobId === j.id ? `1.5px solid ${j.color}` : '1.5px solid #e8e8e8', background: form.jobId === j.id ? `${j.color}15` : '#fafafa', cursor: 'pointer' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{j.name}</div>
                  <div style={{ color: '#999', fontSize: 12 }}>
                    {j.pricing_type === 'fixed'
                      ? `Fixed — ${fmtCAD(j.half_day_rate ?? company?.halfDayRate)}/half · ${fmtCAD(j.full_day_rate ?? company?.fullDayRate)}/full`
                      : `${fmtCAD(j.rate)}/hr`}
                  </div>
                </div>
                {form.jobId === j.id && <Icon name="check" size={15} />}
              </button>
            ))}
          </div>
        </div>
        {employees.length > 0 && (
          <div>
            <label style={lbl}>Employee (optional)</label>
            <select value={form.empId} onChange={e => setForm({ ...form, empId: e.target.value })} style={inp}>
              <option value="">— Me (owner) —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {fmtCAD(e.rate)}/hr</option>)}
            </select>
          </div>
        )}
        {!isEdit && (
          <div><label style={lbl}>Date{confDot(confidence?.date)}</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Start{confDot(confidence?.time)}</label><input type="time" value={form.st} onChange={e => setForm({ ...form, st: e.target.value })} style={inp} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>End{confDot(confidence?.time)}</label><input type="time" value={form.et} onChange={e => setForm({ ...form, et: e.target.value })} style={inp} /></div>
        </div>
        {isFixed && (
          <div>
            <label style={lbl}>Day Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['half', 'full'].map(d => (
                <button key={d} onClick={() => setForm({ ...form, dayType: d })}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: form.dayType === d ? (job?.color || accent) : '#f0f0f0', color: form.dayType === d ? '#fff' : '#888' }}>
                  {d === 'half' ? 'Half Day' : 'Full Day'}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label style={lbl}>Notes (optional)</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Work completed, materials used..."
            style={{ ...inp, height: 68, resize: 'vertical' }} />
        </div>
        {valid && (
          <div style={{ background: `${job?.color}15`, border: `1px solid ${job?.color}33`, borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#888', fontSize: 13 }}>{fmtDur(prevMs)}</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: job?.color, fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>{fmtCAD(prevEarn)}</div>
              {isFixed && form.dayType && <div style={{ color: '#999', fontSize: 12 }}>≈ {fmtCAD(effectiveRate)}/hr</div>}
            </div>
          </div>
        )}
        {!valid && form.st && form.et && (
          <div style={{ color: '#c0392b', fontSize: 12, padding: '8px 12px', background: '#fde8e8', borderRadius: 8 }}>End time must be after start time.</div>
        )}
        <button
          onClick={() => { if (valid && form.jobId && (!isFixed || form.dayType)) onSave({ ...session, job_id: form.jobId, employee_id: form.empId || null, start_time: startDt.toISOString(), end_time: endDt.toISOString(), notes: form.notes || null, day_type: isFixed ? form.dayType : null }); }}
          disabled={!valid || !form.jobId || busy || (isFixed && !form.dayType)}
          style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: valid && form.jobId && (!isFixed || form.dayType) ? job?.color || accent : '#e8e8e8', color: valid && form.jobId && (!isFixed || form.dayType) ? '#fff' : '#aaa', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: valid && form.jobId && (!isFixed || form.dayType) ? 'pointer' : 'not-allowed', opacity: busy ? 0.6 : 1, marginTop: 4 }}>
          {busy ? 'Saving...' : (isEdit ? 'Save Changes' : 'Save Entry')}
        </button>
      </div>
    </Modal>
  );
}
