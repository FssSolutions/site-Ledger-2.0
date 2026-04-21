import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { CRA_RATE } from '../lib/constants.js';
import { fmtCAD, todayStr } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function MileageTab({ jobs, mileage, onAdd, onDelete, busy, isDesktop }) {
  const accent = useAccentColor();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ jobId: jobs[0]?.id || '', date: todayStr(), km: '', note: '' });

  const totalKm = mileage.reduce((s, x) => s + Number(x.km), 0);
  const totalDeduct = totalKm * CRA_RATE;

  function submit() {
    if (!form.km || !form.jobId) return;
    onAdd({ job_id: form.jobId, date: form.date, km: parseFloat(form.km), note: form.note });
    setForm({ jobId: jobs[0]?.id || '', date: todayStr(), km: '', note: '' });
    setShowAdd(false);
  }

  function exportCSV() {
    const rows = [['Date', 'Job', 'KM', 'Deduction (CAD)', 'Note']];
    mileage.forEach(m => {
      const j = jobs.find(x => x.id === m.job_id);
      rows.push([m.date, j?.name || '', m.km, (m.km * CRA_RATE).toFixed(2), m.note || '']);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'mileage-log.csv';
    a.click();
  }

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '16px 16px 0' }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Total KM</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{totalKm.toFixed(0)} km</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>CRA Deduction</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: accent }}>{fmtCAD(totalDeduct)}</div>
        </div>
      </div>
      <div style={{ padding: '4px 16px 0' }}>
        <div style={{ color: '#bbb', fontSize: 11, textAlign: 'right' }}>@ ${CRA_RATE}/km (CRA 2024 rate)</div>
      </div>

      <div style={{ margin: '12px 16px 0' }}>
        <button onClick={() => setShowAdd(!showAdd)} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px dashed #ddd', background: 'transparent', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={14} /> Log Trip
        </button>
      </div>

      {showAdd && (
        <div style={{ ...card, margin: '12px 16px 0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={lbl}>Job</label>
              <select value={form.jobId} onChange={e => setForm({ ...form, jobId: e.target.value })} style={inp}>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Date</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></div>
            <div><label style={lbl}>Distance (km)</label><input type="number" value={form.km} onChange={e => setForm({ ...form, km: e.target.value })} placeholder="e.g. 42" style={inp} /></div>
            <div><label style={lbl}>Note (optional)</label><input type="text" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. Site A to hardware store" style={inp} /></div>
            {form.km && (
              <div style={{ background: `${accent}15`, border: `1px solid ${accent}33`, borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888', fontSize: 13 }}>{form.km} km</span>
                <span style={{ color: accent, fontWeight: 700, fontSize: 13 }}>{fmtCAD(form.km * CRA_RATE)} deduction</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submit} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save Trip</button>
              <button onClick={() => setShowAdd(false)} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {mileage.length > 0 && (
        <div style={{ margin: '16px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ color: '#bbb', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase' }}>Trips</div>
            <button onClick={exportCSV} style={{ ...ib, color: '#888', fontSize: 12, gap: 4 }}><Icon name="dl" size={13} /> Export</button>
          </div>
          {[...mileage].reverse().map(m => {
            const j = jobs.find(x => x.id === m.job_id);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: j?.color || '#ccc', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>{j?.name || 'Unknown'}</div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>{m.date} · {m.km} km{m.note ? ` · ${m.note}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right', marginRight: 4 }}>
                  <div style={{ color: '#111', fontSize: 13, fontWeight: 600 }}>{fmtCAD(m.km * CRA_RATE)}</div>
                  <div style={{ color: '#bbb', fontSize: 11 }}>{m.km} km</div>
                </div>
                <button onClick={() => { if (confirm('Delete this trip?')) onDelete(m.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {mileage.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 14 }}>No trips logged yet.</div>
      )}
    </div>
  );
}
