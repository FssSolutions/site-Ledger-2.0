import { useId, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { fmtCAD } from '../lib/billing.js';
import { todayKey } from '../lib/time.js';
import { mileageEstimates, ratesForYear } from '../lib/mileage.js';
import { toCsv, downloadText } from '../lib/csv.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function MileageTab({ jobs, mileage, onAdd, onDelete, isDesktop }) {
  const accent = useAccentColor();
  const id = useId();
  const activeJobs = jobs.filter(j => (j.status || 'active') === 'active');
  const blank = () => ({ jobId: activeJobs[0]?.id || '', date: todayKey(), km: '', note: '', roundTrip: false });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const year = Number(todayKey().slice(0, 4));
  const rates = ratesForYear(year);
  const est = mileageEstimates(mileage);
  const thisYear = mileage.filter(m => String(m.date).startsWith(String(year)));
  const yearKm = thisYear.reduce((s, x) => s + Number(x.km || 0), 0);
  const yearEstimate = thisYear.reduce((s, m) => s + (est[m.id]?.cents || 0), 0);
  const previewKm = (parseFloat(form.km) || 0) * (form.roundTrip ? 2 : 1);

  async function submit(e) {
    e.preventDefault();
    if (!form.km || saving) return;
    setSaving(true);
    const r = await onAdd({ job_id: form.jobId || null, date: form.date, km: previewKm, note: form.note });
    setSaving(false);
    if (r?.ok) { setForm(blank()); setShowAdd(false); }
  }

  function exportCSV() {
    const rows = [['Date', 'Job', 'KM', 'Estimate at CRA allowance rate (CAD)', 'Note']];
    [...mileage].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(m => {
      const j = jobs.find(x => x.id === m.job_id);
      rows.push([m.date, j?.name || '', Number(m.km), (est[m.id]?.cents || 0) / 100, m.note || '']);
    });
    downloadText('mileage-log.csv', toCsv(rows, { numericCols: [2, 3] }));
  }

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '16px 16px 0' }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{year} business km</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{yearKm.toFixed(0)} km</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Allowance estimate</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: accent }}>{fmtCAD(yearEstimate)}</div>
        </div>
      </div>
      <p style={{ color: '#666', fontSize: 11, padding: '6px 16px 0', lineHeight: 1.5 }}>
        Estimate at CRA reasonable-allowance rates: ${rates.first5000.toFixed(2)}/km for the first 5,000 km, ${rates.after.toFixed(2)}/km after{rates.verified ? '' : ' (rate not yet verified for this year)'}.
        For a self-employed vehicle deduction CRA uses your actual vehicle costs × business-use %; this log records the business kilometres.
      </p>

      <div style={{ margin: '12px 16px 0' }}>
        <button type="button" onClick={() => setShowAdd(!showAdd)} aria-expanded={showAdd} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px dashed #ccc', background: 'transparent', color: '#555', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={14} /> Log Trip
        </button>
      </div>

      {showAdd && (
        <form onSubmit={submit} style={{ ...card, margin: '12px 16px 0', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor={`${id}-job`} style={lbl}>Job</label>
            <select id={`${id}-job`} value={form.jobId} onChange={e => setForm({ ...form, jobId: e.target.value })} style={inp}>
              <option value="">No job (general business)</option>
              {activeJobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </div>
          <div><label htmlFor={`${id}-date`} style={lbl}>Date</label><input id={`${id}-date`} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} required /></div>
          <div><label htmlFor={`${id}-km`} style={lbl}>One-way distance (km)</label><input id={`${id}-km`} type="number" inputMode="decimal" min="0" step="0.1" value={form.km} onChange={e => setForm({ ...form, km: e.target.value })} placeholder="e.g. 42" style={inp} required /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: '#444' }}>
            <input type="checkbox" checked={form.roundTrip} onChange={e => setForm({ ...form, roundTrip: e.target.checked })} style={{ width: 20, height: 20, accentColor: accent }} />
            Round trip <span style={{ color: '#777' }}>(doubles km)</span>
          </label>
          <div><label htmlFor={`${id}-note`} style={lbl}>Note (optional)</label><input id={`${id}-note`} type="text" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. Site A to hardware store" style={inp} /></div>
          {form.km && <div style={{ background: `${accent}15`, border: `1px solid ${accent}33`, borderRadius: 10, padding: '10px 14px', color: '#444', fontSize: 13 }}>{previewKm} km{form.roundTrip ? ' (round trip)' : ''}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save Trip'}</button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #ddd', background: 'transparent', color: '#555', cursor: 'pointer' }}>Cancel</button>
          </div>
        </form>
      )}

      {mileage.length > 0 && (
        <section aria-label="Trips" style={{ margin: '16px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ color: '#777', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase' }}>Trips</div>
            <button type="button" onClick={exportCSV} style={{ ...ib, color: '#555', fontSize: 12, gap: 4, padding: 8 }}><Icon name="dl" size={13} /> Export</button>
          </div>
          {[...mileage].sort((a, b) => (a.date < b.date ? 1 : -1)).map(m => {
            const j = jobs.find(x => x.id === m.job_id);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: j?.color || '#ccc', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>{j?.name || 'General'}{m._sync && m._sync !== 'synced' ? <span style={{ color: '#a35a10', fontSize: 11, fontWeight: 400 }}> · not synced</span> : null}</div>
                  <div style={{ color: '#777', fontSize: 12 }}>{m.date} · {m.km} km{m.note ? ` · ${m.note}` : ''}</div>
                </div>
                <div style={{ color: '#333', fontSize: 13, marginRight: 4 }}>{fmtCAD(est[m.id]?.cents || 0)}</div>
                <button type="button" aria-label="Delete trip" onClick={() => { if (window.confirm('Delete this trip?')) onDelete(m.id); }} style={{ ...ib, color: '#c0392b', padding: 8 }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </section>
      )}

      {mileage.length === 0 && !showAdd && <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 14 }}>No trips logged yet.</div>}
    </div>
  );
}
