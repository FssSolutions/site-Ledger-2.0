import { useState, useRef } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { JOB_COLORS } from '../lib/constants.js';
import { fmtCAD } from '../lib/utils.js';

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

export default function JobsTab({ jobs, onAdd, onUpdate, onDelete, employees, onAddEmp, onUpdateEmp, onDeleteEmp, company, onUpdateCompany }) {
  const [view, setView] = useState('jobs');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', rate: '', notes: '' });
  const [ci, setCi] = useState(0);
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [editEmpId, setEditEmpId] = useState(null);
  const [empForm, setEmpForm] = useState({ name: '', rate: '' });
  const [compForm, setCompForm] = useState(company || {});
  const [compSaved, setCompSaved] = useState(false);
  const fileRef = useRef(null);

  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) { alert('Logo must be under 500KB'); return; }
    const reader = new FileReader();
    reader.onload = () => setCompForm(p => ({ ...p, logo: reader.result }));
    reader.readAsDataURL(file);
  }

  function saveCompany() {
    onUpdateCompany(compForm);
    setCompSaved(true);
    setTimeout(() => setCompSaved(false), 2000);
  }

  return (
    <div style={{ padding: '0 0 100px' }}>
      <div style={{ display: 'flex', background: '#eee', borderRadius: 12, padding: 4, margin: '16px 16px 0', border: '1px solid #e0e0e0' }}>
        {[['jobs', 'Jobs'], ['crew', 'Crew'], ['company', 'Company']].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ flex: 1, padding: '9px', borderRadius: 9, border: 'none', background: view === v ? '#E8651A' : 'transparent', color: view === v ? '#fff' : '#888', fontWeight: view === v ? 700 : 400, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name={v === 'jobs' ? 'note' : v === 'crew' ? 'users' : 'cog'} size={14} />{l}
          </button>
        ))}
      </div>

      {view === 'jobs' && (
        <div style={{ padding: '12px 16px 0' }}>
          {jobs.map(job => (
            <div key={job.id} style={{ ...card, padding: '16px 18px', marginBottom: 10 }}>
              {editId === job.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Job name" style={inp} />
                  <input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="Rate (CAD/hr)" style={inp} />
                  <div><label style={lbl}>Notes</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Address, contact, scope of work..." style={{ ...inp, height: 80, resize: 'vertical' }} /></div>
                  <Swatches ci={ci} setCi={setCi} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { onUpdate({ ...job, name: form.name, rate: parseFloat(form.rate), color: JOB_COLORS[ci % JOB_COLORS.length], notes: form.notes }); setEditId(null); }}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#E8651A', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditId(null)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: job.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{job.name}</div>
                      <div style={{ color: '#999', fontSize: 12 }}>{fmtCAD(job.rate)}/hr</div>
                    </div>
                    <button onClick={() => { setEditId(job.id); setForm({ name: job.name, rate: String(job.rate), notes: job.notes || '' }); setCi(JOB_COLORS.indexOf(job.color) || 0); }} style={{ ...ib, color: '#aaa', marginRight: 4 }}><Icon name="edit" size={15} /></button>
                    <button onClick={() => { if (confirm('Delete this job?')) onDelete(job.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={15} /></button>
                  </div>
                  {job.notes && <div style={{ color: '#999', fontSize: 12, marginTop: 8, paddingLeft: 24, lineHeight: 1.5 }}>{job.notes}</div>}
                </div>
              )}
            </div>
          ))}
          {showAdd ? (
            <div style={{ ...card, padding: '16px 18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Job name" style={inp} />
                <input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="Hourly rate (CAD)" style={inp} />
                <div><label style={lbl}>Notes (optional)</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Address, contact, scope of work..." style={{ ...inp, height: 80, resize: 'vertical' }} /></div>
                <Swatches ci={ci} setCi={setCi} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { if (!form.name || !form.rate) return; onAdd({ name: form.name, rate: parseFloat(form.rate), color: JOB_COLORS[ci % JOB_COLORS.length], notes: form.notes }); setForm({ name: '', rate: '', notes: '' }); setShowAdd(false); }}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#E8651A', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Add Job</button>
                  <button onClick={() => setShowAdd(false)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => { setShowAdd(true); setForm({ name: '', rate: '', notes: '' }); }}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px dashed #ddd', background: 'transparent', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="plus" size={14} /> New Job
            </button>
          )}
        </div>
      )}

      {view === 'crew' && (
        <div style={{ padding: '12px 16px 0' }}>
          {employees.length === 0 && !showAddEmp && <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No crew members yet.</div>}
          {employees.map(emp => (
            <div key={emp.id} style={{ ...card, padding: '16px 18px', marginBottom: 10 }}>
              {editEmpId === emp.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} placeholder="Name" style={inp} />
                  <input type="number" value={empForm.rate} onChange={e => setEmpForm({ ...empForm, rate: e.target.value })} placeholder="Hourly rate (CAD)" style={inp} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { onUpdateEmp({ ...emp, name: empForm.name, rate: parseFloat(empForm.rate) }); setEditEmpId(null); }}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#E8651A', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditEmpId(null)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="user" size={16} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{emp.name}</div>
                    <div style={{ color: '#999', fontSize: 12 }}>{fmtCAD(emp.rate)}/hr</div>
                  </div>
                  <button onClick={() => { setEditEmpId(emp.id); setEmpForm({ name: emp.name, rate: String(emp.rate) }); }} style={{ ...ib, color: '#aaa', marginRight: 4 }}><Icon name="edit" size={15} /></button>
                  <button onClick={() => { if (confirm(`Remove ${emp.name}?`)) onDeleteEmp(emp.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={15} /></button>
                </div>
              )}
            </div>
          ))}
          {showAddEmp ? (
            <div style={{ ...card, padding: '16px 18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} placeholder="Employee name" style={inp} />
                <input type="number" value={empForm.rate} onChange={e => setEmpForm({ ...empForm, rate: e.target.value })} placeholder="Hourly rate (CAD)" style={inp} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { if (!empForm.name || !empForm.rate) return; onAddEmp({ name: empForm.name, rate: parseFloat(empForm.rate) }); setEmpForm({ name: '', rate: '' }); setShowAddEmp(false); }}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#E8651A', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setShowAddEmp(false)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => { setShowAddEmp(true); setEmpForm({ name: '', rate: '' }); }}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px dashed #ddd', background: 'transparent', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="plus" size={14} /> Add Crew Member
            </button>
          )}
        </div>
      )}

      {view === 'company' && (
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ ...card, padding: '20px 18px' }}>
            <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>Company Profile</div>
            <div style={{ color: '#aaa', fontSize: 12, marginBottom: 16 }}>This info appears on your invoices.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Logo */}
              <div>
                <label style={lbl}>Logo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {compForm.logo ? (
                    <div style={{ position: 'relative' }}>
                      <img src={compForm.logo} alt="Logo" style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 8, border: '1px solid #e0e0e0' }} />
                      <button onClick={() => setCompForm(p => ({ ...p, logo: '' }))}
                        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#e74c3c', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        &times;
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => fileRef.current?.click()}
                      style={{ width: 60, height: 60, borderRadius: 8, border: '2px dashed #ddd', background: 'transparent', cursor: 'pointer', color: '#bbb', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      Upload
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
                  <div style={{ color: '#bbb', fontSize: 11 }}>PNG or JPG, max 500KB</div>
                </div>
              </div>

              <div>
                <label style={lbl}>Company Name</label>
                <input style={inp} value={compForm.name || ''} onChange={e => setCompForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Smith Carpentry Ltd." />
              </div>

              <div>
                <label style={lbl}>Phone</label>
                <input style={inp} type="tel" value={compForm.phone || ''} onChange={e => setCompForm(p => ({ ...p, phone: e.target.value }))} placeholder="e.g. (604) 555-1234" />
              </div>

              <div>
                <label style={lbl}>Email</label>
                <input style={inp} type="email" value={compForm.email || ''} onChange={e => setCompForm(p => ({ ...p, email: e.target.value }))} placeholder="e.g. info@smithcarpentry.ca" />
              </div>

              <div>
                <label style={lbl}>Address</label>
                <input style={inp} value={compForm.address || ''} onChange={e => setCompForm(p => ({ ...p, address: e.target.value }))} placeholder="e.g. 123 Main St, Vancouver, BC" />
              </div>

              <div>
                <label style={lbl}>GST Number</label>
                <input style={inp} value={compForm.gstNumber || ''} onChange={e => setCompForm(p => ({ ...p, gstNumber: e.target.value }))} placeholder="e.g. 123456789 RT0001" />
              </div>

              <div>
                <label style={lbl}>WorkSafe BC Number</label>
                <input style={inp} value={compForm.worksafeNumber || ''} onChange={e => setCompForm(p => ({ ...p, worksafeNumber: e.target.value }))} placeholder="e.g. 1234567" />
              </div>

              <button onClick={saveCompany}
                style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: compSaved ? '#3BB273' : '#E8651A', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif", marginTop: 4 }}>
                {compSaved ? 'Saved!' : 'Save Company Info'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
