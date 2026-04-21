import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { JOB_COLORS } from '../lib/constants.js';
import { fmtCAD } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

function Swatches({ ci, setCi }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {JOB_COLORS.map((c, i) => (
        <div key={c} onClick={() => setCi(i)}
          style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', border: ci === i ? '2px solid #111' : '2px solid transparent' }} />
      ))}
    </div>
  );
}

const STATUS_OPTS = ['active', 'complete', 'archived'];
const STATUS_LABELS = { active: 'Active', complete: 'Complete', archived: 'Archived' };
const STATUS_COLORS = { active: '#3BB273', complete: '#2E86AB', archived: '#aaa' };

export default function JobsTab({ jobs, onAdd, onUpdate, onDelete, isDesktop }) {
  const accent = useAccentColor();
  const [statusFilter, setStatusFilter] = useState('active');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', rate: '', notes: '', address: '', status: 'active' });
  const [ci, setCi] = useState(0);

  const filtered = statusFilter === 'all' ? jobs : jobs.filter(j => (j.status || 'active') === statusFilter);

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '16px 16px 0' }}>
        {['active', 'complete', 'archived', 'all'].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            style={{ padding: '6px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: statusFilter === f ? accent : '#f0f0f0',
              color: statusFilter === f ? '#fff' : '#888' }}>
            {f === 'all' ? 'All' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 16px 0' }}>
        {filtered.length === 0 && !showAdd && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 14 }}>
            No {statusFilter === 'all' ? '' : statusFilter} jobs.
          </div>
        )}

        {filtered.map(job => (
          <div key={job.id} style={{ ...card, padding: '16px 18px', marginBottom: 10 }}>
            {editId === job.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Job name" style={inp} />
                <input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="Rate (CAD/hr)" style={inp} />
                <div><label style={lbl}>Address (optional)</label><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, Vancouver, BC" style={inp} /></div>
                <div><label style={lbl}>Notes</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Contact, scope of work..." style={{ ...inp, height: 80, resize: 'vertical' }} /></div>
                <div>
                  <label style={lbl}>Status</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {STATUS_OPTS.map(s => (
                      <button key={s} onClick={() => setForm({ ...form, status: s })}
                        style={{ padding: '6px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          background: form.status === s ? STATUS_COLORS[s] : '#f0f0f0',
                          color: form.status === s ? '#fff' : '#888' }}>
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <Swatches ci={ci} setCi={setCi} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { onUpdate({ ...job, name: form.name, rate: parseFloat(form.rate), color: JOB_COLORS[ci % JOB_COLORS.length], notes: form.notes, address: form.address, status: form.status }); setEditId(null); }}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                  <button onClick={() => setEditId(null)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: job.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{job.name}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                        background: STATUS_COLORS[job.status || 'active'] + '22',
                        color: STATUS_COLORS[job.status || 'active'] }}>
                        {STATUS_LABELS[job.status || 'active']}
                      </span>
                    </div>
                    <div style={{ color: '#999', fontSize: 12 }}>{fmtCAD(job.rate)}/hr</div>
                  </div>
                  <button onClick={() => { setEditId(job.id); setForm({ name: job.name, rate: String(job.rate), notes: job.notes || '', address: job.address || '', status: job.status || 'active' }); setCi(JOB_COLORS.indexOf(job.color) || 0); }} style={{ ...ib, color: '#aaa', marginRight: 4 }}><Icon name="edit" size={15} /></button>
                  <button onClick={() => { if (confirm('Delete this job?')) onDelete(job.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={15} /></button>
                </div>
                {job.address && <div style={{ color: '#888', fontSize: 12, marginTop: 6, paddingLeft: 24 }}>{job.address}</div>}
                {job.notes && <div style={{ color: '#999', fontSize: 12, marginTop: 4, paddingLeft: 24, lineHeight: 1.5 }}>{job.notes}</div>}
              </div>
            )}
          </div>
        ))}

        {showAdd ? (
          <div style={{ ...card, padding: '16px 18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Job name" style={inp} />
              <input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="Hourly rate (CAD)" style={inp} />
              <div><label style={lbl}>Address (optional)</label><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, Vancouver, BC" style={inp} /></div>
              <div><label style={lbl}>Notes (optional)</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Contact, scope of work..." style={{ ...inp, height: 80, resize: 'vertical' }} /></div>
              <Swatches ci={ci} setCi={setCi} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { if (!form.name || !form.rate) return; onAdd({ name: form.name, rate: parseFloat(form.rate), color: JOB_COLORS[ci % JOB_COLORS.length], notes: form.notes, address: form.address, status: 'active' }); setForm({ name: '', rate: '', notes: '', address: '', status: 'active' }); setShowAdd(false); }}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Add Job</button>
                <button onClick={() => setShowAdd(false)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => { setShowAdd(true); setForm({ name: '', rate: '', notes: '', address: '', status: 'active' }); }}
            style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px dashed #ddd', background: 'transparent', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={14} /> New Job
          </button>
        )}
      </div>
    </div>
  );
}
