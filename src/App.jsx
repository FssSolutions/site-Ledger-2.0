import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './lib/api.js';
import { loadAuth, saveAuth, clearAuth } from './lib/auth.js';
import { cacheData, loadCachedData, enqueue, getQueue, removeFromQueue, isOnline } from './lib/offline.js';
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
import CompanyTab from './pages/CompanyTab.jsx';
import { useWindowWidth } from './hooks/useWindowWidth.js';
import AccentColorContext from './lib/AccentColorContext.js';
import SettingsModal from './components/SettingsModal.jsx';

const TABS = [
  { id: 'clock', l: 'Clock', i: 'clock' },
  { id: 'calendar', l: 'Calendar', i: 'cal' },
  { id: 'mileage', l: 'Mileage', i: 'truck' },
  { id: 'reports', l: 'Reports', i: 'chart' },
  { id: 'jobs', l: 'Jobs', i: 'note' },
  { id: 'company', l: 'Company', i: 'building' },
];

function companyToDb(d) {
  return {
    name: d.name || null, phone: d.phone || null, email: d.email || null,
    address: d.address || null, gst_number: d.gstNumber || null,
    worksafe_number: d.worksafeNumber || null, logo: d.logo || null,
  };
}

function companyFromDb(r) {
  return {
    id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '',
    address: r.address || '', gstNumber: r.gst_number || '',
    worksafeNumber: r.worksafe_number || '', logo: r.logo || '',
  };
}

export default function App() {
  const [authData, setAuthData] = useState(() => loadAuth());
  const [jobs, setJobs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [mileage, setMileage] = useState([]);
  const [company, setCompany] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sl_company') || '{}'); } catch { return {}; }
  });
  const [customers, setCustomers] = useState([]);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState(() => localStorage.getItem('sl_default_tab') || 'clock');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [queueCount, setQueueCount] = useState(getQueue().length);
  const syncingRef = useRef(false);
  const token = authData?.access_token;
  const width = useWindowWidth();
  const isDesktop = width >= 768;
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('sl_accent_color') || '#E8651A');
  const [taxRate, setTaxRate] = useState(() => parseFloat(localStorage.getItem('sl_tax_rate') || '5'));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { localStorage.setItem('sl_accent_color', accentColor); }, [accentColor]);
  useEffect(() => { localStorage.setItem('sl_tax_rate', String(taxRate)); }, [taxRate]);

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
    if (jobs.length || sessions.length || employees.length || mileage.length || customers.length || company?.name) {
      cacheData({ jobs, sessions, employees, mileage, customers, active, company });
    }
  }, [jobs, sessions, employees, mileage, customers, active, company]);

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
        setCustomers(cached.customers || []);
        if (cached.company) setCompany(cached.company);
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
      const [j, s, e, m, c, cp] = await Promise.all([
        withRefresh(t => api.select(t, 'jobs')),
        withRefresh(t => api.select(t, 'sessions')),
        withRefresh(t => api.select(t, 'employees')),
        withRefresh(t => api.select(t, 'mileage')),
        withRefresh(t => api.select(t, 'customers')),
        withRefresh(t => api.select(t, 'company_profiles')),
      ]);
      const anyFailed = [j, s, e, m, c, cp].some(x => x === null || x?._expired);
      if (anyFailed) {
        const cached = loadCachedData();
        if (cached) {
          setJobs(cached.jobs || []); setSessions(cached.sessions || []);
          setEmployees(cached.employees || []); setMileage(cached.mileage || []);
          setCustomers(cached.customers || []);
          if (cached.company) setCompany(cached.company);
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
        if (Array.isArray(c)) setCustomers(c);
        if (Array.isArray(cp) && cp[0]) {
          const mapped = companyFromDb(cp[0]);
          setCompany(mapped);
          localStorage.setItem('sl_company', JSON.stringify(mapped));
        }
      }
    } catch {
      const cached = loadCachedData();
      if (cached) {
        setJobs(cached.jobs || []); setSessions(cached.sessions || []);
        setEmployees(cached.employees || []); setMileage(cached.mileage || []);
        setCustomers(cached.customers || []);
        if (cached.company) setCompany(cached.company);
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
        } else if (op.type === 'upsert_company') {
          const body = userId ? { ...op.body, user_id: userId } : op.body;
          await withRefresh(t => api.upsert(t, 'company_profiles', body));
        }
        removeFromQueue(op.id);
        setQueueCount(getQueue().length);
      } catch {
        break;
      }
    }

    syncingRef.current = false;
    setSyncing(false);
    setQueueCount(getQueue().length);

    if (getQueue().length === 0) {
      toast('All changes synced!', 'success');
      loadData();
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

  // --- Data mutations ---
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

  async function updateCompany(data) {
    setCompany(data);
    localStorage.setItem('sl_company', JSON.stringify(data));
    if (!isOnline()) {
      enqueue({ type: 'upsert_company', body: companyToDb(data) });
      setQueueCount(getQueue().length);
      return;
    }
    try {
      const u = await withRefresh(t => api.user(t));
      if (!u?.id) { toast('Could not save company info.'); return; }
      const r = await withRefresh(t => api.upsert(t, 'company_profiles', { ...companyToDb(data), user_id: u.id }));
      if (Array.isArray(r) && r[0]) {
        const mapped = companyFromDb(r[0]);
        setCompany(mapped);
        localStorage.setItem('sl_company', JSON.stringify(mapped));
      }
    } catch { toast('Network error. Company info saved locally.'); }
  }

  async function addCustomer(cust) {
    if (offlineInsert('customers', cust, () => setCustomers(p => [...p, { ...cust, id: 'temp-' + Date.now() }]))) return;
    try {
      const u = await withRefresh(t => api.user(t));
      if (!u?.id) { toast('Failed to add customer.'); return; }
      const r = await withRefresh(t => api.insert(t, 'customers', { ...cust, user_id: u.id }));
      if (Array.isArray(r) && r[0]) setCustomers(p => [...p, r[0]]);
      else toast('Failed to add customer.');
    } catch { toast('Network error. Could not add customer.'); }
  }
  async function updateCustomer(cust) {
    const body = { name: cust.name, phone: cust.phone, email: cust.email, address: cust.address };
    if (offlineUpdate('customers', cust.id, body, () => setCustomers(p => p.map(c => c.id === cust.id ? { ...c, ...body } : c)))) return;
    try {
      const r = await withRefresh(t => api.update(t, 'customers', cust.id, body));
      if (Array.isArray(r) && r[0]) setCustomers(p => p.map(c => c.id === cust.id ? r[0] : c));
      else toast('Failed to update customer.');
    } catch { toast('Network error. Could not update customer.'); }
  }
  async function deleteCustomer(id) {
    if (offlineDelete('customers', id, () => setCustomers(p => p.filter(c => c.id !== id)))) return;
    try { await withRefresh(t => api.delete(t, 'customers', id)); setCustomers(p => p.filter(c => c.id !== id)); }
    catch { toast('Failed to delete customer.'); }
  }

  async function signOut() {
    if (token) await api.signOut(token);
    clearAuth();
    setAuthData(null);
    setJobs([]); setSessions([]); setEmployees([]); setMileage([]); setCustomers([]); setActive(null);
    setCompany({});
    localStorage.removeItem('sl_company');
  }

  const tabContent = (
    <>
      {tab === 'clock' && <ClockTab jobs={jobs} employees={employees} sessions={sessions} active={active} onIn={clockIn} onOut={clockOut} onSave={saveSession} onDelete={deleteSession} busy={busy} isDesktop={isDesktop} />}
      {tab === 'calendar' && <CalendarTab jobs={jobs} employees={employees} sessions={sessions} onSave={saveSession} onDelete={deleteSession} busy={busy} isDesktop={isDesktop} />}
      {tab === 'mileage' && <MileageTab jobs={jobs} mileage={mileage} onAdd={addMileage} onDelete={deleteMileage} busy={busy} isDesktop={isDesktop} />}
      {tab === 'reports' && <ReportsTab jobs={jobs} employees={employees} sessions={sessions} mileage={mileage} company={company} customers={customers} taxRate={taxRate} isDesktop={isDesktop} />}
      {tab === 'jobs' && <JobsTab jobs={jobs} onAdd={addJob} onUpdate={updateJob} onDelete={deleteJob} isDesktop={isDesktop} />}
      {tab === 'company' && <CompanyTab employees={employees} onAddEmp={addEmployee} onUpdateEmp={updateEmployee} onDeleteEmp={deleteEmployee} customers={customers} onAddCust={addCustomer} onUpdateCust={updateCustomer} onDeleteCust={deleteCustomer} company={company} onUpdateCompany={updateCompany} isDesktop={isDesktop} />}
    </>
  );

  const loadingState = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: '#aaa', fontSize: 14 }}>Loading your data...</div>
  );

  const errorState = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ color: '#c0392b', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
      <div style={{ color: '#999', fontSize: 14, marginBottom: 20 }}>Could not load your data. This could be a network issue or the server may be temporarily unavailable.</div>
      <button onClick={loadData} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: '#E8651A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Try Again</button>
    </div>
  );

  const settingsModal = showSettings ? (
    <SettingsModal
      accentColor={accentColor}
      onAccentChange={setAccentColor}
      taxRate={taxRate}
      onTaxChange={setTaxRate}
      onClose={() => setShowSettings(false)}
    />
  ) : null;

  if (!authData) return (
    <AccentColorContext.Provider value={accentColor}>
      <AuthScreen onAuth={d => { saveAuth(d); setAuthData(d); }} />
    </AccentColorContext.Provider>
  );

  // --- Desktop layout ---
  if (isDesktop) {
    return (
      <AccentColorContext.Provider value={accentColor}>
      <div style={{ display: 'flex', height: '100vh', background: '#f4f4f4', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Toasts — fixed top-right */}
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onDone={() => removeToast(t.id)} />)}
        </div>

        {/* Sidebar */}
        <div style={{ width: 220, minWidth: 220, height: '100vh', background: '#fff', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, flexShrink: 0 }}>
          <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -0.5 }}>
              Site<span style={{ color: accentColor }}>Ledger</span>
            </div>
            {active && <div style={{ fontSize: 11, color: accentColor, fontFamily: "'DM Mono', monospace", letterSpacing: 1, marginTop: 4 }}>● CLOCKED IN</div>}
          </div>
          <div style={{ flex: 1, padding: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, border: 'none', background: tab === t.id ? '#E8651A18' : 'transparent', color: tab === t.id ? '#E8651A' : '#555', fontSize: 14, fontWeight: tab === t.id ? 700 : 400, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: "'DM Sans', sans-serif" }}>
                <Icon name={t.i} size={17} />
                {t.l}
              </button>
            ))}
          </div>
          <div style={{ padding: '16px 12px', borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={() => setShowSettings(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', color: '#666', fontSize: 13, cursor: 'pointer', width: '100%', fontFamily: "'DM Sans', sans-serif", textAlign: 'left' }}>
              <Icon name="cog" size={16} /> Settings
            </button>
            <button onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', color: '#aaa', fontSize: 13, cursor: 'pointer', width: '100%', fontFamily: "'DM Sans', sans-serif" }}>
              <Icon name="logout" size={16} /> Sign Out
            </button>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <OfflineBanner online={online} syncing={syncing} queueCount={queueCount} />
          <div style={{ maxWidth: 900, width: '100%', alignSelf: 'center', flex: 1 }}>
            {loading ? loadingState : loadError ? errorState : tabContent}
          </div>
        </div>
        {settingsModal}
      </div>
      </AccentColorContext.Provider>
    );
  }

  // --- Mobile layout ---
  return (
    <AccentColorContext.Provider value={accentColor}>
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: '#f4f4f4', fontFamily: "'DM Sans', sans-serif", position: 'relative' }}>
      {toasts.map(t => (
        <Toast key={t.id} message={t.message} type={t.type} onDone={() => removeToast(t.id)} />
      ))}

      <OfflineBanner online={online} syncing={syncing} queueCount={queueCount} />

      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e8e8e8', background: '#fff' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -0.5 }}>
            Site<span style={{ color: accentColor }}>Ledger</span>
          </div>
          {active && <div style={{ fontSize: 11, color: accentColor, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>● CLOCKED IN</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setShowSettings(true)} style={{ ...ib, color: '#aaa' }} aria-label="Settings"><Icon name="cog" size={18} /></button>
          <button onClick={signOut} style={{ ...ib, color: '#aaa' }} aria-label="Sign out"><Icon name="logout" size={18} /></button>
        </div>
      </div>

      {loading ? loadingState : loadError ? errorState : tabContent}

      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#fff', borderTop: '1px solid #e8e8e8', display: 'flex', padding: '8px 0 12px' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0', color: tab === t.id ? accentColor : '#aaa' }}>
            <Icon name={t.i} size={19} />
            <span style={{ fontSize: 9, fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>{t.l}</span>
          </button>
        ))}
      </div>
      {settingsModal}
    </div>
    </AccentColorContext.Provider>
  );
}
