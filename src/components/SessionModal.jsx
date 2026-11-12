import { useId, useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import Icon from './Icon.jsx';
import { inp, lbl } from '../styles.js';
import { MN } from '../lib/constants.js';
import { fmtDur } from '../lib/utils.js';
import { fmtCAD as fmtCents, sessionBilling, sessionLabourCents, snapshotFor } from '../lib/billing.js';
import { localDateKey, localTimeHHMM, combineLocal, validateSessionTimes, todayKey } from '../lib/time.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

// onSave(payload) must return a promise of { ok, error }. The modal stays
// open (keeping the draft) until the save succeeds.
export default function SessionModal({ session, initialSession, voiceMeta, date, jobs, employees, company, onSave, onSaved, onClose }) {
  const accent = useAccentColor();
  const id = useId();
  const draft = session || initialSession || null;
  const isEdit = !!session?.id;
  const startTs = draft?.start_time ? new Date(draft.start_time) : null;
  const endTs = draft?.end_time ? new Date(draft.end_time) : null;
  const [form, setForm] = useState({
    jobId: draft ? draft.job_id || '' : jobs.find(j => (j.status || 'active') === 'active')?.id || '',
    empId: draft?.employee_id || '',
    date: startTs ? localDateKey(startTs) : date ? localDateKey(date) : todayKey(),
    st: startTs ? localTimeHHMM(startTs) : '08:00',
    et: endTs ? localTimeHHMM(endTs) : '16:00',
    overnight: !!(startTs && endTs && localDateKey(endTs) !== localDateKey(startTs)),
    breakMin: draft?.break_seconds ? String(Math.round(draft.break_seconds / 60)) : '',
    notes: draft?.notes || '',
    dayType: draft?.day_type || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = patch => { setForm(f => ({ ...f, ...patch })); setError(''); };

  const job = jobs.find(j => j.id === form.jobId);
  const employee = employees.find(e => e.id === form.empId) || null;
  const isFixed = job?.pricing_type === 'fixed';
  const { start, end } = combineLocal(form.date, form.st || '00:00', form.et || '00:00', { overnight: form.overnight });
  const breakSeconds = Math.max(0, Math.round((Number(form.breakMin) || 0) * 60));
  const problem = validateSessionTimes(start, end, breakSeconds);
  const endsBeforeStart = !form.overnight && form.et <= form.st;
  const pickableJobs = jobs.filter(j => (j.status || 'active') === 'active' || j.id === draft?.job_id);

  const preview = !problem && job ? (() => {
    const s = {
      job_id: job.id, employee_id: employee?.id || null, start_time: start.toISOString(), end_time: end.toISOString(),
      break_seconds: breakSeconds, day_type: isFixed ? form.dayType || null : null,
      ...snapshotFor({ job, employee, company, dayType: isFixed ? form.dayType : null }),
    };
    const data = { jobs, employees, company };
    return { ms: end - start - breakSeconds * 1000, bill: sessionBilling(s, data), labour: sessionLabourCents(s, data) };
  })() : null;

  const subtitle = voiceMeta ? 'Review voice entry' : isEdit ? 'Edit entry'
    : date ? `${MN[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : 'New entry';
  const warnings = voiceMeta?.warnings || [];
  const assumptions = voiceMeta?.assumptions || [];
  const confidence = voiceMeta?.confidence || null;
  const canSave = !problem && form.jobId && (!isFixed || form.dayType) && !saving;

  function confDot(score) {
    if (!confidence || score == null) return null;
    const color = score >= 0.8 ? '#3BB273' : score >= 0.5 ? '#E67E22' : '#C0392B';
    const label = score >= 0.8 ? 'High confidence' : score >= 0.5 ? 'Low confidence — verify' : 'Very low confidence — verify';
    return <span title={label} aria-label={label} role="img" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, marginLeft: 5, verticalAlign: 'middle' }} />;
  }

  async function save(e) {
    e?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const r = await onSave({
      id: session?.id, job_id: form.jobId, employee_id: form.empId || null,
      start_time: start.toISOString(), end_time: end.toISOString(), break_seconds: breakSeconds,
      notes: form.notes || null, day_type: isFixed ? form.dayType : null,
    });
    setSaving(false);
    if (r?.ok) onSaved ? onSaved(r) : onClose();
    else setError(r?.error || 'Could not save. Your entry is still here.');
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={isEdit ? 'Edit Entry' : 'Add Entry'} subtitle={subtitle} onClose={onClose} />
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {session?.invoice_id && (
          <div style={{ border: '1px solid #D6EAF8', borderRadius: 12, background: '#EBF5FB', padding: '10px 14px', color: '#1B6C8F', fontSize: 12 }}>
            This entry is already billed. Changes here do not change the recorded invoice, or any invoice already sent.
          </div>
        )}
        {voiceMeta && (
          <div style={{ border: '1px solid #f0c070', borderRadius: 12, background: '#fffaf2', padding: '12px 14px' }}>
            <div style={{ color: '#a35a10', fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Voice draft — check before saving</div>
            {warnings.map((w, i) => <div key={`w${i}`} style={{ color: '#7a4a10', fontSize: 12, marginBottom: 4 }}>{w}</div>)}
            {assumptions.map((a, i) => <div key={`a${i}`} style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>{a}</div>)}
            {voiceMeta.transcript && (
              <details>
                <summary style={{ color: '#666', fontSize: 12, cursor: 'pointer' }}>Transcript</summary>
                <div style={{ color: '#555', fontSize: 12, lineHeight: 1.5, marginTop: 8, whiteSpace: 'pre-wrap' }}>{voiceMeta.transcript}</div>
              </details>
            )}
          </div>
        )}
        <fieldset style={{ border: 'none' }}>
          <legend style={lbl}>Job{confDot(confidence?.job)}</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pickableJobs.map(j => (
              <button key={j.id} type="button" onClick={() => set({ jobId: j.id })} aria-pressed={form.jobId === j.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, border: form.jobId === j.id ? `1.5px solid ${j.color}` : '1.5px solid #e8e8e8', background: form.jobId === j.id ? `${j.color}15` : '#fafafa', cursor: 'pointer' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: j.color, flexShrink: 0 }} />
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{j.name}</div>
                  <div style={{ color: '#777', fontSize: 12 }}>
                    {j.pricing_type === 'fixed'
                      ? `Fixed — ${fmtCents(Math.round((j.half_day_rate ?? company?.halfDayRate ?? 0) * 100))}/half · ${fmtCents(Math.round((j.full_day_rate ?? company?.fullDayRate ?? 0) * 100))}/full, per person`
                      : `${fmtCents(Math.round((j.rate ?? 0) * 100))}/hr billed`}
                  </div>
                </div>
                {form.jobId === j.id && <Icon name="check" size={15} />}
              </button>
            ))}
          </div>
        </fieldset>
        {employees.length > 0 && (
          <div>
            <label htmlFor={`${id}-emp`} style={lbl}>Who worked</label>
            <select id={`${id}-emp`} value={form.empId} onChange={e => set({ empId: e.target.value })} style={inp}>
              <option value="">Me (owner)</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {fmtCents(Math.round((e.rate ?? 0) * 100))}/hr wage</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-date`} style={lbl}>Date{confDot(confidence?.date)}</label>
          <input id={`${id}-date`} type="date" value={form.date} onChange={e => set({ date: e.target.value })} style={inp} required />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><label htmlFor={`${id}-st`} style={lbl}>Start{confDot(confidence?.time)}</label><input id={`${id}-st`} type="time" value={form.st} onChange={e => set({ st: e.target.value })} style={inp} required /></div>
          <div style={{ flex: 1 }}><label htmlFor={`${id}-et`} style={lbl}>End{confDot(confidence?.time)}</label><input id={`${id}-et`} type="time" value={form.et} onChange={e => set({ et: e.target.value })} style={inp} required /></div>
        </div>
        {(endsBeforeStart || form.overnight) && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#333' }}>
            <input type="checkbox" checked={form.overnight} onChange={e => set({ overnight: e.target.checked })} style={{ width: 20, height: 20 }} />
            Ends the next day (overnight shift)
          </label>
        )}
        <div>
          <label htmlFor={`${id}-brk`} style={lbl}>Unpaid break (minutes)</label>
          <input id={`${id}-brk`} type="number" inputMode="numeric" min="0" step="1" value={form.breakMin} onChange={e => set({ breakMin: e.target.value })} placeholder="0" style={inp} />
        </div>
        {isFixed && (
          <fieldset style={{ border: 'none' }}>
            <legend style={lbl}>Day Type</legend>
            <div style={{ display: 'flex', gap: 8 }}>
              {['half', 'full'].map(d => (
                <button key={d} type="button" onClick={() => set({ dayType: d })} aria-pressed={form.dayType === d}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: form.dayType === d ? (job?.color || accent) : '#f0f0f0', color: form.dayType === d ? '#fff' : '#555' }}>
                  {d === 'half' ? 'Half Day' : 'Full Day'}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor={`${id}-notes`} style={lbl}>Notes (optional)</label>
          <textarea id={`${id}-notes`} value={form.notes} onChange={e => set({ notes: e.target.value })}
            placeholder="Work completed, materials used..." style={{ ...inp, height: 68, resize: 'vertical' }} />
        </div>
        {preview && (
          <div style={{ background: `${job?.color}15`, border: `1px solid ${job?.color}33`, borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#666', fontSize: 13 }}>{fmtDur(preview.ms)} worked</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#111', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>{fmtCents(preview.bill.amountCents)} <span style={{ fontSize: 11, color: '#777', fontWeight: 400 }}>billed</span></div>
              {employee && <div style={{ color: '#777', fontSize: 12 }}>{fmtCents(preview.labour)} labour cost</div>}
            </div>
          </div>
        )}
        {problem && form.st && form.et && (
          <div role="alert" style={{ color: '#a93226', fontSize: 12, padding: '8px 12px', background: '#fde8e8', borderRadius: 8 }}>
            {endsBeforeStart && !form.overnight ? 'End time is before the start. Tick "Ends the next day" for an overnight shift.' : problem}
          </div>
        )}
        {error && <div role="alert" style={{ color: '#a93226', fontSize: 13, padding: '10px 12px', background: '#fde8e8', borderRadius: 8 }}>{error}</div>}
        <button type="submit" disabled={!canSave}
          style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: canSave ? job?.color || accent : '#e0e0e0', color: canSave ? '#fff' : '#777', fontSize: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: canSave ? 'pointer' : 'not-allowed', marginTop: 4 }}>
          {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Save Entry')}
        </button>
      </form>
    </Modal>
  );
}
