import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './lib/api.js';
import { loadAuth, saveAuth, clearAuth } from './lib/auth.js';
import { cacheData, loadCachedData, enqueue, getQueue, clearQueue, removeFromQueue, isOnline } from './lib/offline.js';
import { ib } from './styles.js';
import Icon from './components/Icon.jsx';
import Toast from './components/Toast.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
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
  const [loadError, setLoadError] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [queueCount, setQueueCount] = useState(getQueue().length);
  const syncingRef = useRef(false);
  const token = authData?.access_token;

  function toast(message, type = 'error') {
    const id = Date.now();
    setToasts(p => [...p, { id, message, type }]);
  }

  function removeToast(id) {
    setToasts(p => p.filter(t => t.id !== id));
  }

  // --- Online/offline detection ---
  useEffect(() => {
    function goOnline() { setOnline(true); }
    function goOffline() { setOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // --- Token refresh ---
  async function tryRefresh() {
    const rt = authData?.refresh_token;
    if (!rt) return null;
    const d = await api.refreshToken(rt);
    if (d.access_token) { saveAuth(d); setAuthData(d); return d.access_token; }
    clearAuth(); setAuthData(null); return null;
  }

  async function withRefresh(fn) {
    let result = await fn(token);
    if (result && result._expired) {
      const newToken = await tryRefresh();
      if (newToken) result = await fn(newToken);
      else return null;
    }
    return result;
  }

  useEffect(() => {
    if (!authData?.refresh_token) return;
    const interval = setInterval(() => { tryRefresh(); }, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authData?.refresh_token]);

  // --- Cache data whenever it changes ---
  useEffect(() => {
    if (jobs.length || sessions.length || employees.length || mileage.length) {
      cacheData({ jobs, sessions, employees, mileage, active });
    }
  }, [jobs, sessions, employees, mileage, active]);

  // --- Load data (with offline fallback) ---
  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(false);

    if (!isOnline()) {
      const cached = loadCachedData();
      if (cached) {
        setJobs(cached.jobs || []);
        setSessions(cached.sessions || []);
        setEmployees(cached.employees || []);
        setMileage(cached.mileage || []);
        setActive(cached.active || null);
        toast('Loaded from cache — you are offline.', 'info');
      } else {
        setLoadError(true);
        toast('No internet and no cached data available.');
      }
      setLoading(false);
      return;
    }

    try {
      const [j, s, e, m] = await Promise.all([
        withRefresh(t => api.select(t, 'jobs')),
        withRefresh(t => api.select(t, 'sessions')),
        withRefresh(t => api.select(t, 'employees')),
        withRefresh(t => api.select(t, 'mileage')),
      ]);
      const anyFailed = [j, s, e, m].some(x => x === null || x?._expired);
      if (anyFailed) {
        // Try cache as fallback
        const cached = loadCachedData();
        if (cached) {
          setJobs(cached.jobs || []); setSessions(cached.sessions || []);
          setEmployees(cached.employees || []); setMileage(cached.mileage || []);
          setActive(cached.active || null);
          toast('Could not reach server — showing cached data.');
        } else {
          setLoadError(true);
          toast('Could not load your data. Check your connection and try again.');
        }
      } else {
        if (Array.isArray(j)) setJobs(j);
        if (Array.isArray(s)) { setSessions(s.filter(x => x.end_time)); setActive(s.find(x => !x.end_time) || null); }
        if (Array.isArray(e)) setEmployees(e);
        if (Array.isArray(m)) setMileage(m);
      }
    } catch {
      const cached = loadCachedData();
      if (cached) {
        setJobs(cached.jobs || []); setSessions(cached.sessions || []);
        setEmployees(cached.employees || []); setMileage(cached.mileage || []);
        setActive(cached.active || null);
        toast('Network error — showing cached data.');
      } else {
        setLoadError(true);
        toast('Network error. Please check your connection.');
      }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- Sync queue when coming back online ---
  async function syncQueue() {
    if (syncingRef.current) return;
    const queue = getQueue();
    if (queue.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    setQueueCount(queue.length);

    let userId = null;
    try {
      const u = await withRefresh(t => api.user(t));
      userId = u?.id;
    } catch {}

    for (const op of queue) {
      try {
        if (op.type === 'insert') {
          const body = userId ? { ...op.body, user_id: userId } : op.body;
          await withRefresh(t => api.insert(t, op.table, body));
        } else if (op.type === 'update') {
          await withRefresh(t => api.update(t, op.table, op.recordId, op.body));
        } else if (op.type === 'delete') {
          await withRefresh(t => api.delete(t, op.table, op.recordId));
        }
        removeFromQueue(op.id);
        setQueueCount(getQueue().length);
      } catch {
        // Stop syncing on failure, will retry later
        break;
      }
    }

    syncingRef.current = false;
    setSyncing(false);
    setQueueCount(getQueue().length);

    if (getQueue().length === 0) {
      toast('All changes synced!', 'success');
      loadData(); // Refresh to get server state
    }
  }

  useEffect(() => {
    if (online && token) syncQueue();
  }, [online, token]);

  // --- Offline-aware mutation helpers ---
  function offlineInsert(table, body, optimisticUpdate) {
    if (!isOnline()) {
      enqueue({ type: 'insert', table, body });
      setQueueCount(getQueue().length);
      if (optimisticUpdate) optimisticUpdate();
      return true;
    }
    return false;
  }

  function offlineUpdate(table, recordId, body, optimisticUpdate) {
    if (!isOnline()) {
      enqueue({ type: 'update', table, recordId, body });
      setQueueCount(getQueue().length);
      if (optimisticUpdate) optimisticUpdate();
      return true;
    }
    return false;
  }

  function offlineDelete(table, recordId, optimisticUpdate) {
    if (!isOnline()) {
      enqueue({ type: 'delete', table, recordId });
      setQueueCount(getQueue().length);
      if (optimisticUpdate) optimisticUpdate();
      return true;
    }
    return false;
  }

  // --- Data mutations (online-first, offline fallback) ---
  async function clockIn(jobId, empId) {
    const startTime = new Date().toISOString();
    const body = { job_id: jobId, employee_id: empId || null, start_time: startTime };

    if (offlineInsert('sessions', body, () => {
      const tempId = 'temp-' + Date.now();
      setActive({ ...body, id: tempId });
    })) return;

    setBusy(true);
    try {
      const u = await withRefresh(t => api.user(t));
      if (!u?.id) { toast('Failed to clock in. Please try again.'); setBusy(false); return; }
      const r = await withRefresh(t => api.insert(t, 'sessions', { ...body, user_id: u.id }));
      if (Array.isArray(r) && r[0]) setActive(r[0]);
      else toast('Failed to clock in. Please try again.');
    } catch { toast('Network error. Could not clock in.'); }
    setBusy(false);
  }

  async function clockOut() {
    if (!active) return;
    const endTime = new Date().toISOString();

    if (active.id?.toString().startsWith('temp-')) {
      // Was clocked in offline — queue the whole session as an insert
      enqueue({ type: 'insert', table: 'sessions', body: { ...active, end_time: endTime } });
      setQueueCount(getQueue().length);
      setSessions(p => [...p, { ...active, end_time: endTime }]);
      setActive(null);
      return;
    }

    if (offlineUpdate('sessions', active.id, { end_time: endTime }, () => {
      setSessions(p => [...p, { ...active, end_time: endTime }]);
      setActive(null);
    })) return;

    setBusy(true);
    try {
      const r = await withRefresh(t => api.update(t, 'sessions', active.id, { end_time: endTime }));
      if (Array.isArray(r) && r[0]) { setSessions(p => [...p, r[0]]); setActive(null); }
      else toast('Failed to clock out. Please try again.');
    } catch { toast('Network error. Could not clock out.'); }
    setBusy(false);
  }

  async function saveSession(sess, onDone) {
    if (sess.id) {
      const body = { job_id: sess.job_id, employee_id: sess.employee_id, start_time: sess.start_time, end_time: sess.end_time };
      if (offlineUpdate('sessions', sess.id, body, () => {
        setSessions(p => p.map(s => s.id === sess.id ? { ...s, ...body } : s));
        if (onDone) onDone();
      })) return;
    } else {
      const body = { job_id: sess.job_id, employee_id: sess.employee_id, start_time: sess.start_time, end_time: sess.end_time };
      if (offlineInsert('sessions', body, () => {
        setSessions(p => [...p, { ...body, id: 'temp-' + Date.now() }]);
        if (onDone) onDone();
      })) return;
    }

    setBusy(true);
    try {
      if (sess.id) {
        const r = await withRefresh(t => api.update(t, 'sessions', sess.id, { job_id: sess.job_id, employee_id: sess.employee_id, start_time: sess.start_time, end_time: sess.end_time }));
        if (Array.isArray(r) && r[0]) setSessions(p => p.map(s => s.id === sess.id ? r[0] : s));
        else { toast('Failed to save entry.'); setBusy(false); return; }
      } else {
        const u = await withRefresh(t => api.user(t));
        if (!u?.id) { toast('Failed to save entry.'); setBusy(false); return; }
        const r = await withRefresh(t => api.insert(t, 'sessions', { ...sess, user_id: u.id }));
        if (Array.isArray(r) && r[0]) setSessions(p => [...p, r[0]]);
        else { toast('Failed to save entry.'); setBusy(false); return; }
      }
    } catch { toast('Network error. Could not save.'); }
    setBusy(false);
    if (onDone) onDone();
  }

  async function deleteSession(id) {
    if (offlineDelete('sessions', id, () => setSessions(p => p.filter(s => s.id !== id)))) return;
    try { await withRefresh(t => api.delete(t, 'sessions', id)); setSessions(p => p.filter(s => s.id !== id)); }
    catch { toast('Failed to delete entry.'); }
  }

  async function addJob(job) {
    if (offlineInsert('jobs', job, () => setJobs(p => [...p, { ...job, id: 'temp-' + Date.now() }]))) return;
    try {
      const u = await withRefresh(t => api.user(t));
      if (!u?.id) { toast('Failed to add job.'); return; }
      const r = await withRefresh(t => api.insert(t, 'jobs', { ...job, user_id: u.id }));
      if (Array.isArray(r) && r[0]) setJobs(p => [...p, r[0]]);
      else toast('Failed to add job.');
    } catch { toast('Network error. Could not add job.'); }
  }
  async function updateJob(job) {
    const body = { name: job.name, rate: job.rate, color: job.color, notes: job.notes };
    if (offlineUpdate('jobs', job.id, body, () => setJobs(p => p.map(j => j.id === job.id ? { ...j, ...body } : j)))) return;
    try {
      const r = await withRefresh(t => api.update(t, 'jobs', job.id, body));
      if (Array.isArray(r) && r[0]) setJobs(p => p.map(j => j.id === job.id ? r[0] : j));
      else toast('Failed to update job.');
    } catch { toast('Network error. Could not update job.'); }
  }
  async function deleteJob(id) {
    if (offlineDelete('jobs', id, () => { setJobs(p => p.filter(j => j.id !== id)); setSessions(p => p.filter(s => s.job_id !== id)); })) return;
    try { await withRefresh(t => api.delete(t, 'jobs', id)); setJobs(p => p.filter(j => j.id !== id)); setSessions(p => p.filter(s => s.job_id !== id)); }
    catch { toast('Failed to delete job.'); }
  }

  async function addEmployee(emp) {
    if (offlineInsert('employees', emp, () => setEmployees(p => [...p, { ...emp, id: 'temp-' + Date.now() }]))) return;
    try {
      const u = await withRefresh(t => api.user(t));
      if (!u?.id) { toast('Failed to add employee.'); return; }
      const r = await withRefresh(t => api.insert(t, 'employees', { ...emp, user_id: u.id }));
      if (Array.isArray(r) && r[0]) setEmployees(p => [...p, r[0]]);
      else toast('Failed to add employee.');
    } catch { toast('Network error. Could not add employee.'); }
  }
  async function updateEmployee(emp) {
    const body = { name: emp.name, rate: emp.rate };
    if (offlineUpdate('employees', emp.id, body, () => setEmployees(p => p.map(e => e.id === emp.id ? { ...e, ...body } : e)))) return;
    try {
      const r = await withRefresh(t => api.update(t, 'employees', emp.id, body));
      if (Array.isArray(r) && r[0]) setEmployees(p => p.map(e => e.id === emp.id ? r[0] : e));
      else toast('Failed to update employee.');
    } catch { toast('Network error. Could not update employee.'); }
  }
  async function deleteEmployee(id) {
    if (offlineDelete('employees', id, () => setEmployees(p => p.filter(e => e.id !== id)))) return;
    try { await withRefresh(t => api.delete(t, 'employees', id)); setEmployees(p => p.filter(e => e.id !== id)); }
    catch { toast('Failed to delete employee.'); }
  }

  async function addMileage(m) {
    if (offlineInsert('mileage', m, () => setMileage(p => [...p, { ...m, id: 'temp-' + Date.now() }]))) return;
    try {
      const u = await withRefresh(t => api.user(t));
      if (!u?.id) { toast('Failed to log trip.'); return; }
      const r = await withRefresh(t => api.insert(t, 'mileage', { ...m, user_id: u.id }));
      if (Array.isArray(r) && r[0]) setMileage(p => [...p, r[0]]);
      else toast('Failed to log trip.');
    } catch { toast('Network error. Could not log trip.'); }
  }
  async function deleteMileage(id) {
    if (offlineDelete('mileage', id, () => setMileage(p => p.filter(m => m.id !== id)))) return;
    try { await withRefresh(t => api.delete(t, 'mileage', id)); setMileage(p => p.filter(m => m.id !== id)); }
    catch { toast('Failed to delete trip.'); }
  }

  async function signOut() {
    if (token) await api.signOut(token);
    clearAuth();
    setAuthData(null);
    setJobs([]); setSessions([]); setEmployees([]); setMileage([]); setActive(null);
  }

  if (!authData) return <AuthScreen onAuth={d => { saveAuth(d); setAuthData(d); }} />;

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: '#f4f4f4', fontFamily: "'DM Sans', sans-serif", position: 'relative' }}>
      {toasts.map(t => (
        <Toast key={t.id} message={t.message} type={t.type} onDone={() => removeToast(t.id)} />
      ))}

      <OfflineBanner online={online} syncing={syncing} queueCount={queueCount} />

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
      ) : loadError ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ color: '#c0392b', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ color: '#999', fontSize: 14, marginBottom: 20 }}>Could not load your data. This could be a network issue or the server may be temporarily unavailable.</div>
          <button onClick={loadData} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: '#E8651A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Try Again</button>
        </div>
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
