import { useState, useEffect } from 'react';
import { api } from './lib/api.js';
import { loadAuth, saveAuth, clearAuth } from './lib/auth.js';
import { ib } from './styles.js';
import Icon from './components/Icon.jsx';
import AuthScreen from './pages/AuthScreen.jsx';
import ClockTab from './pages/ClockTab.jsx';
import CalendarTab from './pages/CalendarTab.jsx';
import MileageTab from './pages/MileageTab.jsx';
import ReportsTab from './pages/ReportsTab.jsx';
import JobsTab from './pages/JobsTab.jsx';

const TABS = [
  { id: 'clock', l: 'Clock', i: 'clock' },
  { id: 'calendar', l: 'Calendar', i: 'cal' },
  { id: 'mileage', l: 'Mileage', i: 'truck' },
  { id: 'reports', l: 'Reports', i: 'chart' },
  { id: 'jobs', l: 'Jobs', i: 'cog' },
];

export default function App() {
  const [authData, setAuthData] = useState(() => loadAuth());
  const [jobs, setJobs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [mileage, setMileage] = useState([]);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState('clock');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const token = authData?.access_token;

  useEffect(() => {
    if (!token) return;
    async function load() {
      setLoading(true);
      const [j, s, e, m] = await Promise.all([
        api.select(token, 'jobs'),
        api.select(token, 'sessions'),
        api.select(token, 'employees'),
        api.select(token, 'mileage'),
      ]);
      if (Array.isArray(j)) setJobs(j);
      if (Array.isArray(s)) { setSessions(s.filter(x => x.end_time)); setActive(s.find(x => !x.end_time) || null); }
      if (Array.isArray(e)) setEmployees(e);
      if (Array.isArray(m)) setMileage(m);
      setLoading(false);
    }
    load();
  }, [token]);

  async function clockIn(jobId, empId) {
    setBusy(true);
    const u = await api.user(token);
    const r = await api.insert(token, 'sessions', { job_id: jobId, employee_id: empId || null, start_time: new Date().toISOString(), user_id: u.id });
    if (Array.isArray(r) && r[0]) setActive(r[0]);
    setBusy(false);
  }

  async function clockOut() {
    if (!active) return;
    setBusy(true);
    const r = await api.update(token, 'sessions', active.id, { end_time: new Date().toISOString() });
    if (Array.isArray(r) && r[0]) { setSessions(p => [...p, r[0]]); setActive(null); }
    setBusy(false);
  }

  async function saveSession(sess, onDone) {
    setBusy(true);
    if (sess.id) {
      const r = await api.update(token, 'sessions', sess.id, { job_id: sess.job_id, employee_id: sess.employee_id, start_time: sess.start_time, end_time: sess.end_time });
      if (Array.isArray(r) && r[0]) setSessions(p => p.map(s => s.id === sess.id ? r[0] : s));
    } else {
      const u = await api.user(token);
      const r = await api.insert(token, 'sessions', { ...sess, user_id: u.id });
      if (Array.isArray(r) && r[0]) setSessions(p => [...p, r[0]]);
    }
    setBusy(false);
    if (onDone) onDone();
  }

  async function deleteSession(id) { await api.delete(token, 'sessions', id); setSessions(p => p.filter(s => s.id !== id)); }

  async function addJob(job) { const u = await api.user(token); const r = await api.insert(token, 'jobs', { ...job, user_id: u.id }); if (Array.isArray(r) && r[0]) setJobs(p => [...p, r[0]]); }
  async function updateJob(job) { const r = await api.update(token, 'jobs', job.id, { name: job.name, rate: job.rate, color: job.color, notes: job.notes }); if (Array.isArray(r) && r[0]) setJobs(p => p.map(j => j.id === job.id ? r[0] : j)); }
  async function deleteJob(id) { await api.delete(token, 'jobs', id); setJobs(p => p.filter(j => j.id !== id)); setSessions(p => p.filter(s => s.job_id !== id)); }

  async function addEmployee(emp) { const u = await api.user(token); const r = await api.insert(token, 'employees', { ...emp, user_id: u.id }); if (Array.isArray(r) && r[0]) setEmployees(p => [...p, r[0]]); }
  async function updateEmployee(emp) { const r = await api.update(token, 'employees', emp.id, { name: emp.name, rate: emp.rate }); if (Array.isArray(r) && r[0]) setEmployees(p => p.map(e => e.id === emp.id ? r[0] : e)); }
  async function deleteEmployee(id) { await api.delete(token, 'employees', id); setEmployees(p => p.filter(e => e.id !== id)); }

  async function addMileage(m) { const u = await api.user(token); const r = await api.insert(token, 'mileage', { ...m, user_id: u.id }); if (Array.isArray(r) && r[0]) setMileage(p => [...p, r[0]]); }
  async function deleteMileage(id) { await api.delete(token, 'mileage', id); setMileage(p => p.filter(m => m.id !== id)); }

  async function signOut() {
    if (token) await api.signOut(token);
    clearAuth();
    setAuthData(null);
    setJobs([]); setSessions([]); setEmployees([]); setMileage([]); setActive(null);
  }

  if (!authData) return <AuthScreen onAuth={d => { saveAuth(d); setAuthData(d); }} />;

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: '#f4f4f4', fontFamily: "'DM Sans', sans-serif", position: 'relative' }}>
      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e8e8e8', background: '#fff' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -0.5 }}>
            Site<span style={{ color: '#E8651A' }}>Ledger</span>
          </div>
          {active && <div style={{ fontSize: 11, color: '#E8651A', fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>● CLOCKED IN</div>}
        </div>
        <button onClick={signOut} style={{ ...ib, color: '#aaa' }}><Icon name="logout" size={18} /></button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: '#aaa', fontSize: 14 }}>Loading your data...</div>
      ) : (
        <>
          {tab === 'clock' && <ClockTab jobs={jobs} employees={employees} sessions={sessions} active={active} onIn={clockIn} onOut={clockOut} onSave={saveSession} onDelete={deleteSession} busy={busy} />}
          {tab === 'calendar' && <CalendarTab jobs={jobs} employees={employees} sessions={sessions} onSave={saveSession} onDelete={deleteSession} busy={busy} />}
          {tab === 'mileage' && <MileageTab jobs={jobs} mileage={mileage} onAdd={addMileage} onDelete={deleteMileage} busy={busy} />}
          {tab === 'reports' && <ReportsTab jobs={jobs} employees={employees} sessions={sessions} mileage={mileage} />}
          {tab === 'jobs' && <JobsTab jobs={jobs} onAdd={addJob} onUpdate={updateJob} onDelete={deleteJob} employees={employees} onAddEmp={addEmployee} onUpdateEmp={updateEmployee} onDeleteEmp={deleteEmployee} />}
        </>
      )}

      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#fff', borderTop: '1px solid #e8e8e8', display: 'flex', padding: '8px 0 12px' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0', color: tab === t.id ? '#E8651A' : '#aaa' }}>
            <Icon name={t.i} size={19} />
            <span style={{ fontSize: 9, fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>{t.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
