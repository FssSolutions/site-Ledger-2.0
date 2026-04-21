import { useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import Icon from './Icon.jsx';
import { inp, lbl } from '../styles.js';
import { MN } from '../lib/constants.js';
import { fmtDur, fmtCAD, dayKey, todayStr } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function SessionModal({ session, date, jobs, employees, onSave, onClose, busy }) {
  const accent = useAccentColor();
  const isEdit = !!session;
  const defaultDate = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : todayStr();
  const defaultSt = isEdit ? new Date(session.start_time).toTimeString().slice(0, 5) : '08:00';
  const defaultEt = isEdit && session.end_time ? new Date(session.end_time).toTimeString().slice(0, 5) : '16:00';
  const [form, setForm] = useState({
    jobId: session?.job_id || jobs[0]?.id || '',
    empId: session?.employee_id || '',
    date: isEdit ? dayKey(session.start_time) : defaultDate,
    st: defaultSt,
    et: defaultEt,
  });

  const startDt = new Date(`${form.date}T${form.st}`);
  const endDt = new Date(`${form.date}T${form.et}`);
  const valid = endDt > startDt;
  const job = jobs.find(j => j.id === form.jobId);
  const prevMs = valid ? endDt - startDt : 0;
  const prevEarn = valid && job ? (prevMs / 3600000) * job.rate : 0;
  const subtitle = isEdit
    ? 'Edit entry'
    : date ? `${MN[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : 'New entry';

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={isEdit ? 'Edit Entry' : 'Add Entry'} subtitle={subtitle} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={lbl}>Job</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map(j => (
              <button key={j.id} onClick={() => setForm({ ...form, jobId: j.id })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, border: form.jobId === j.id ? `1.5px solid ${j.color}` : '1.5px solid #e8e8e8', background: form.jobId === j.id ? `${j.color}15` : '#fafafa', cursor: 'pointer' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{j.name}</div>
                  <div style={{ color: '#999', fontSize: 12 }}>{fmtCAD(j.rate)}/hr</div>
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
          <div><label style={lbl}>Date</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Start</label><input type="time" value={form.st} onChange={e => setForm({ ...form, st: e.target.value })} style={inp} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>End</label><input type="time" value={form.et} onChange={e => setForm({ ...form, et: e.target.value })} style={inp} /></div>
        </div>
        {valid && (
          <div style={{ background: `${job?.color}15`, border: `1px solid ${job?.color}33`, borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#888', fontSize: 13 }}>{fmtDur(prevMs)}</div>
            <div style={{ color: job?.color, fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>{fmtCAD(prevEarn)}</div>
          </div>
        )}
        {!valid && form.st && form.et && (
          <div style={{ color: '#c0392b', fontSize: 12, padding: '8px 12px', background: '#fde8e8', borderRadius: 8 }}>End time must be after start time.</div>
        )}
        <button
          onClick={() => { if (valid && form.jobId) onSave({ ...session, job_id: form.jobId, employee_id: form.empId || null, start_time: startDt.toISOString(), end_time: endDt.toISOString() }); }}
          disabled={!valid || busy}
          style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: valid ? job?.color || accent : '#e8e8e8', color: valid ? '#fff' : '#aaa', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: valid ? 'pointer' : 'not-allowed', opacity: busy ? 0.6 : 1, marginTop: 4 }}>
          {busy ? 'Saving...' : (isEdit ? 'Save Changes' : 'Save Entry')}
        </button>
      </div>
    </Modal>
  );
}
