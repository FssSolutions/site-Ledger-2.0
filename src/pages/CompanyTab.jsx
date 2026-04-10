import { useState, useRef } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { fmtCAD } from '../lib/utils.js';

export default function CompanyTab({ employees, onAddEmp, onUpdateEmp, onDeleteEmp, customers, onAddCust, onUpdateCust, onDeleteCust, company, onUpdateCompany, isDesktop }) {
  const [view, setView] = useState('crew');

  // --- Crew state ---
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [editEmpId, setEditEmpId] = useState(null);
  const [empForm, setEmpForm] = useState({ name: '', rate: '' });

  // --- Customer state ---
  const [showAddCust, setShowAddCust] = useState(false);
  const [editCustId, setEditCustId] = useState(null);
  const [custForm, setCustForm] = useState({ name: '', phone: '', email: '', address: '' });

  // --- Company state ---
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
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      <div style={{ display: 'flex', background: '#eee', borderRadius: 12, padding: 4, margin: '16px 16px 0', border: '1px solid #e0e0e0' }}>
        {[['crew', 'Crew'], ['customers', 'Customers'], ['profile', 'Profile']].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ flex: 1, padding: '9px', borderRadius: 9, border: 'none', background: view === v ? '#E8651A' : 'transparent', color: view === v ? '#fff' : '#888', fontWeight: view === v ? 700 : 400, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name={v === 'crew' ? 'users' : v === 'customers' ? 'user' : 'cog'} size={14} />{l}
          </button>
        ))}
      </div>

      {/* ---- CREW ---- */}
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

      {/* ---- CUSTOMERS ---- */}
      {view === 'customers' && (
        <div style={{ padding: '12px 16px 0' }}>
          {customers.length === 0 && !showAddCust && <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No customers yet.</div>}
          {customers.map(cust => (
            <div key={cust.id} style={{ ...card, padding: '16px 18px', marginBottom: 10 }}>
              {editCustId === cust.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={custForm.name} onChange={e => setCustForm({ ...custForm, name: e.target.value })} placeholder="Customer name" style={inp} />
                  <input value={custForm.phone} onChange={e => setCustForm({ ...custForm, phone: e.target.value })} placeholder="Phone number" type="tel" style={inp} />
                  <input value={custForm.email} onChange={e => setCustForm({ ...custForm, email: e.target.value })} placeholder="Email" type="email" style={inp} />
                  <input value={custForm.address} onChange={e => setCustForm({ ...custForm, address: e.target.value })} placeholder="Address" style={inp} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { if (!custForm.name) return; onUpdateCust({ ...cust, ...custForm }); setEditCustId(null); }}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#E8651A', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditCustId(null)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="user" size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{cust.name}</div>
                    {cust.phone && <div style={{ color: '#999', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="phone" size={11} />{cust.phone}</div>}
                    {cust.email && <div style={{ color: '#999', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Icon name="mail" size={11} />{cust.email}</div>}
                    {cust.address && <div style={{ color: '#999', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="map" size={11} />{cust.address}</div>}
                  </div>
                  <button onClick={() => { setEditCustId(cust.id); setCustForm({ name: cust.name, phone: cust.phone || '', email: cust.email || '', address: cust.address || '' }); }} style={{ ...ib, color: '#aaa', marginRight: 4 }}><Icon name="edit" size={15} /></button>
                  <button onClick={() => { if (confirm(`Remove ${cust.name}?`)) onDeleteCust(cust.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={15} /></button>
                </div>
              )}
            </div>
          ))}
          {showAddCust ? (
            <div style={{ ...card, padding: '16px 18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={custForm.name} onChange={e => setCustForm({ ...custForm, name: e.target.value })} placeholder="Customer name" style={inp} />
                <input value={custForm.phone} onChange={e => setCustForm({ ...custForm, phone: e.target.value })} placeholder="Phone number" type="tel" style={inp} />
                <input value={custForm.email} onChange={e => setCustForm({ ...custForm, email: e.target.value })} placeholder="Email" type="email" style={inp} />
                <input value={custForm.address} onChange={e => setCustForm({ ...custForm, address: e.target.value })} placeholder="Address" style={inp} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { if (!custForm.name) return; onAddCust({ name: custForm.name, phone: custForm.phone, email: custForm.email, address: custForm.address }); setCustForm({ name: '', phone: '', email: '', address: '' }); setShowAddCust(false); }}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#E8651A', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setShowAddCust(false)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => { setShowAddCust(true); setCustForm({ name: '', phone: '', email: '', address: '' }); }}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px dashed #ddd', background: 'transparent', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="plus" size={14} /> Add Customer
            </button>
          )}
        </div>
      )}

      {/* ---- COMPANY PROFILE ---- */}
      {view === 'profile' && (
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
