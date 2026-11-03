import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { ib } from './styles.js';
import Icon from './components/Icon.jsx';
import Toast from './components/Toast.jsx';
import SyncStatus from './components/SyncStatus.jsx';
import PendingChangesModal from './components/PendingChangesModal.jsx';
import LegacyReview from './components/LegacyReview.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import { ConfirmDialog } from './components/Modal.jsx';
import AuthScreen, { NewPasswordScreen } from './pages/AuthScreen.jsx';
import DashboardTab from './pages/DashboardTab.jsx';
import ClockTab from './pages/ClockTab.jsx';
import CalendarTab from './pages/CalendarTab.jsx';
import { useWindowWidth } from './hooks/useWindowWidth.js';
import { useAuth } from './hooks/useAuth.js';
import { useLedger } from './hooks/useLedger.js';
import { usePrefs } from './hooks/usePrefs.js';
import AccentColorContext from './lib/AccentColorContext.js';
import SettingsModal from './components/SettingsModal.jsx';
import { processVoiceEntry } from './lib/voiceApi.js';

// Less-used screens load on demand (all are precached for offline use).
const MileageTab = lazy(() => import('./pages/MileageTab.jsx'));
const ExpensesTab = lazy(() => import('./pages/ExpensesTab.jsx'));
const ReportsTab = lazy(() => import('./pages/ReportsTab.jsx'));
const JobsTab = lazy(() => import('./pages/JobsTab.jsx'));
const CompanyTab = lazy(() => import('./pages/CompanyTab.jsx'));
const InvoiceModal = lazy(() => import('./components/InvoiceModal.jsx'));

const TABS = [
  { id: 'home', l: 'Home', i: 'home' },
  { id: 'clock', l: 'Clock', i: 'clock' },
  { id: 'calendar', l: 'Calendar', i: 'cal' },
  { id: 'mileage', l: 'Mileage', i: 'truck' },
  { id: 'expenses', l: 'Expenses', i: 'dollar' },
  { id: 'reports', l: 'Reports', i: 'chart' },
  { id: 'jobs', l: 'Jobs', i: 'note' },
  { id: 'company', l: 'Company', i: 'building' },
];
const NAV_PRIMARY = ['home', 'clock', 'calendar', 'reports'];
const NAV_MORE = ['mileage', 'expenses', 'jobs', 'company'];

function useOnlineHint() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

const Centered = ({ children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', color: '#777', fontSize: 14, textAlign: 'center' }}>{children}</div>
);

export default function App() {
  const auth = useAuth();
  const prefs = usePrefs();
  const online = useOnlineHint();
  const user = auth.status === 'signed-in' || auth.status === 'offline' ? auth.user : null;
  const ledger = useLedger(user, { online });
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('sl_default_tab') || 'home'; } catch { return 'home'; } });
  const [showMore, setShowMore] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [voiceInvoiceRequest, setVoiceInvoiceRequest] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);
  const width = useWindowWidth();
  const isDesktop = width >= 768;
  const { view } = ledger;

  const toast = useCallback((message, type = 'error') => {
    const id = ++toastSeq.current;
    setToasts(p => [...p, { id, message, type }]);
  }, []);
  const removeToast = id => setToasts(p => p.filter(t => t.id !== id));

  useEffect(() => {
    if (auth.notice?.kind === 'password-updated') { toast('Password updated.', 'success'); auth.dismissNotice(); }
  }, [auth.notice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reminder: only fires while the app is open (see Settings).
  const reminderFired = useRef('');
  useEffect(() => {
    if (!view.active || !prefs.reminderTime) return undefined;
    function check() {
      const now = new Date();
      const [rh, rm] = prefs.reminderTime.split(':').map(Number);
      const key = now.toDateString();
      if ((now.getHours() > rh || (now.getHours() === rh && now.getMinutes() >= rm)) && reminderFired.current !== key) {
        reminderFired.current = key;
        toast("You're still clocked in — don't forget to clock out!", 'info');
      }
    }
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [view.active, prefs.reminderTime, toast]);

  // Runs an action and reports failures; returns the result so forms can
  // stay open with their draft on failure.
  const run = useCallback(async (p, successMsg) => {
    const r = await p;
    if (!r.ok) toast(r.error);
    else if (successMsg) toast(successMsg, 'success');
    return r;
  }, [toast]);

  async function finishSignOut() {
    setConfirm(null);
    await ledger.prepareSignOut();
    await auth.signOut();
    // Reload drops every in-memory record and any in-flight request.
    window.location.reload();
  }

  function requestSignOut() {
    const n = ledger.pendingCount;
    if (n === 0) {
      setConfirm({
        title: 'Sign out?',
        message: 'Your synced records will be removed from this device. Sign in again (needs internet) to see them.',
        actions: [
          { label: 'Sign out', primary: true, onClick: finishSignOut },
          { label: 'Cancel', autoFocus: true, onClick: () => setConfirm(null) },
        ],
      });
      return;
    }
    setConfirm({
      title: `${n} change${n === 1 ? '' : 's'} not synced yet`,
      message: `They stay saved on this device and will upload the next time ${auth.user?.email || 'this account'} signs in here. Anyone using this phone could see them in the browser's storage. Signing in again needs internet.`,
      actions: [
        { label: 'Try to sync first', primary: true, autoFocus: true, onClick: async () => { setConfirm(null); await ledger.syncNow(); setShowPending(true); } },
        { label: 'Sign out and keep changes on this device', onClick: finishSignOut },
        { label: 'Cancel', onClick: () => setConfirm(null) },
      ],
    });
  }

  if (auth.status === 'unconfigured') {
    return <Centered><b>SiteLedger is not configured.</b><br />Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).</Centered>;
  }
  if (auth.status === 'loading') return <Centered>Loading…</Centered>;
  if (auth.status === 'recovery') return <AccentColorContext.Provider value={prefs.accentColor}><NewPasswordScreen auth={auth} /></AccentColorContext.Provider>;
  if (!user) return <AccentColorContext.Provider value={prefs.accentColor}><AuthScreen auth={auth} /></AccentColorContext.Provider>;

  const common = { jobs: view.jobs, employees: view.employees, sessions: view.sessions, company: view.company, isDesktop };
  const breakState = view.active ? {
    pausedAt: view.active.break_started_at ? Date.parse(view.active.break_started_at) : null,
    totalBreakMs: (Number(view.active.break_seconds) || 0) * 1000,
  } : { pausedAt: null, totalBreakMs: 0 };
  const a = ledger.actions;
  const goTo = id => { setTab(id); setShowMore(false); };

  const tabContent = (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      {tab === 'home' && <DashboardTab {...common} invoices={view.invoices} active={view.active} breakState={breakState} otRules={prefs.otRules} onGoTo={goTo} />}
      {tab === 'clock' && <ClockTab {...common} active={view.active} openSessions={view.openSessions} breakState={breakState} otRules={prefs.otRules}
        onIn={(j, e) => run(a.clockIn(j, e))} onOut={(endTime, dayType) => run(a.clockOut({ endTime, dayType }))}
        onPause={() => run(a.startBreak())} onResume={() => run(a.endBreak())}
        onSave={s => run(a.saveSession(s))} onDelete={id => run(a.deleteSession(id))}
        onVoiceInvoice={setVoiceInvoiceRequest} online={online}
        onVoiceProcess={(blob, meta, signal) => processVoiceEntry(user.uid, blob, { ...meta, jobs: view.jobs.filter(j => (j.status || 'active') === 'active'), customers: view.customers }, signal)} />}
      {tab === 'calendar' && <CalendarTab {...common} invoices={view.invoices} otRules={prefs.otRules} onSave={s => run(a.saveSession(s))} onDelete={id => run(a.deleteSession(id))} />}
      {tab === 'mileage' && <MileageTab jobs={view.jobs} mileage={view.mileage} onAdd={m => run(a.addMileage(m))} onDelete={id => run(a.deleteMileage(id))} isDesktop={isDesktop} />}
      {tab === 'expenses' && <ExpensesTab jobs={view.jobs} expenses={view.expenses} onAdd={e => run(a.addExpense(e))} onDelete={id => run(a.deleteExpense(id))} isDesktop={isDesktop} />}
      {tab === 'reports' && <ReportsTab {...common} openSessions={view.openSessions} mileage={view.mileage} expenses={view.expenses} customers={view.customers} invoices={view.invoices} taxRate={prefs.taxRate} otRules={prefs.otRules} ledger={ledger} toast={toast} />}
      {tab === 'jobs' && <JobsTab {...common} onAdd={j => run(a.addJob(j))} onUpdate={j => run(a.updateJob(j))} onDelete={id => run(a.deleteJob(id))} />}
      {tab === 'company' && <CompanyTab {...common} customers={view.customers} invoices={view.invoices} invoiceLines={view.invoiceLines}
        onAddEmp={e => run(a.addEmployee(e))} onUpdateEmp={e => run(a.updateEmployee(e))} onDeleteEmp={id => run(a.deleteEmployee(id))}
        onAddCust={c => run(a.addCustomer(c))} onUpdateCust={c => run(a.updateCustomer(c))} onDeleteCust={id => run(a.deleteCustomer(id))}
        onSetInvoiceStatus={(id, st) => run(ledger.setInvoiceStatus(id, st))} onDeleteInvoice={id => run(ledger.deleteInvoice(id), 'Invoice deleted; its hours are unbilled again.')}
        onUpdateCompany={d => run(a.saveCompany(d), 'Company info saved on this device.')} taxRate={prefs.taxRate} />}
    </Suspense>
  );

  const body = !ledger.ready ? <Centered>Opening your data on this device…</Centered>
    : ledger.storageError ? (
      <Centered>
        <div role="alert" style={{ color: '#a93226', fontWeight: 600, marginBottom: 8 }}>Offline storage is unavailable</div>
        <div style={{ marginBottom: 16 }}>{ledger.storageError} Changes cannot be saved on this device until this is fixed (e.g. leave private browsing, free up storage).</div>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: prefs.accentColor, color: '#fff', fontWeight: 700 }}>Reload</button>
      </Centered>
    ) : tabContent;

  const banner = (
    <>
      <UpdateBanner />
      <SyncStatus authStatus={auth.status} sync={ledger.sync} pendingCount={ledger.pendingCount} problemCount={ledger.problemOps.length} online={online} onOpen={() => setShowPending(true)} />
      {ledger.legacy && <LegacyReview legacy={ledger.legacy} uid={user.uid} ledger={ledger} toast={toast} />}
    </>
  );

  const overlays = (
    <>
      {showSettings && <SettingsModal prefs={prefs} onClose={() => setShowSettings(false)} />}
      {showPending && <PendingChangesModal ops={ledger.ops} view={view} syncState={ledger.sync.state} onClose={() => setShowPending(false)}
        onRetry={id => ledger.retryOp(id)} onDiscard={id => ledger.discardOp(id)} onResolve={(id, c) => ledger.resolveConflict(id, c)} onSyncNow={() => ledger.syncNow()} />}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {voiceInvoiceRequest && (
        <Suspense fallback={null}>
          <InvoiceModal {...common} customers={view.customers} openSessions={view.openSessions} taxRate={prefs.taxRate} voiceRequest={voiceInvoiceRequest}
            ledger={ledger} toast={toast} onClose={() => setVoiceInvoiceRequest(null)} />
        </Suspense>
      )}
    </>
  );

  const toastsEl = (
    <div aria-live="assertive" style={isDesktop ? { position: 'fixed', top: 16, right: 16, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8 } : undefined}>
      {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onDone={() => removeToast(t.id)} />)}
    </div>
  );

  const clockedIn = view.active && <div style={{ fontSize: 11, color: prefs.accentColor, fontFamily: "'DM Mono', monospace", letterSpacing: 1, marginTop: 4 }}>● CLOCKED IN</div>;

  if (isDesktop) {
    return (
      <AccentColorContext.Provider value={prefs.accentColor}>
        <div style={{ display: 'flex', height: '100vh', background: '#f4f4f4', fontFamily: "'DM Sans', sans-serif" }}>
          {toastsEl}
          <nav aria-label="Main" style={{ width: 220, minWidth: 220, height: '100vh', background: '#fff', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, flexShrink: 0 }}>
            <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -0.5 }}>Site<span style={{ color: prefs.accentColor }}>Ledger</span></div>
              {clockedIn}
              <div style={{ fontSize: 11, color: '#888', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth.user?.email}</div>
            </div>
            <div style={{ flex: 1, padding: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
              {TABS.map(t => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, border: 'none', background: tab === t.id ? `${prefs.accentColor}18` : 'transparent', color: tab === t.id ? prefs.accentColor : '#444', fontSize: 14, fontWeight: tab === t.id ? 700 : 400, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  <Icon name={t.i} size={17} />{t.l}
                </button>
              ))}
            </div>
            <div style={{ padding: '16px 12px', borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" onClick={() => setShowSettings(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', color: '#555', fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                <Icon name="cog" size={16} /> Settings
              </button>
              <button type="button" onClick={requestSignOut} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', color: '#666', fontSize: 13, cursor: 'pointer', width: '100%' }}>
                <Icon name="logout" size={16} /> Sign Out
              </button>
            </div>
          </nav>
          <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {banner}
            <div style={{ maxWidth: 900, width: '100%', alignSelf: 'center', flex: 1 }}>{body}</div>
          </main>
          {overlays}
        </div>
      </AccentColorContext.Provider>
    );
  }

  return (
    <AccentColorContext.Provider value={prefs.accentColor}>
      <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: '#f4f4f4', fontFamily: "'DM Sans', sans-serif", position: 'relative' }}>
        {toastsEl}
        {banner}
        <header style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e8e8e8', background: '#fff' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -0.5 }}>Site<span style={{ color: prefs.accentColor }}>Ledger</span></div>
            {clockedIn}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={() => setShowSettings(true)} style={{ ...ib, color: '#777', padding: 10 }} aria-label="Settings"><Icon name="cog" size={18} /></button>
            <button type="button" onClick={requestSignOut} style={{ ...ib, color: '#777', padding: 10 }} aria-label="Sign out"><Icon name="logout" size={18} /></button>
          </div>
        </header>
        <main>{body}</main>

        {showMore && <div onClick={() => setShowMore(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />}
        {showMore && (
          <div id="more-menu" style={{ position: 'fixed', bottom: 56, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#fff', borderTop: '1px solid #e8e8e8', boxShadow: '0 -6px 24px rgba(0,0,0,0.10)', zIndex: 100, borderRadius: '16px 16px 0 0', paddingBottom: 4 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e0e0e0', margin: '10px auto 8px' }} />
            {NAV_MORE.map(id => {
              const t = TABS.find(x => x.id === id);
              return (
                <button key={id} type="button" onClick={() => goTo(id)} aria-current={tab === id ? 'page' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', color: tab === id ? prefs.accentColor : '#333', fontSize: 15, fontWeight: tab === id ? 700 : 400 }}>
                  <Icon name={t.i} size={18} />{t.l}
                </button>
              );
            })}
          </div>
        )}
        <nav aria-label="Main" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#fff', borderTop: '1px solid #e8e8e8', display: 'flex', padding: '8px 0 calc(12px + env(safe-area-inset-bottom))', zIndex: 98 }}>
          {NAV_PRIMARY.map(id => {
            const t = TABS.find(x => x.id === id);
            return (
              <button key={id} type="button" onClick={() => goTo(id)} aria-current={tab === id ? 'page' : undefined}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0', color: tab === id ? prefs.accentColor : '#767676' }}>
                <Icon name={t.i} size={19} />
                <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>{t.l}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => setShowMore(s => !s)} aria-expanded={showMore} aria-controls="more-menu"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0', color: (showMore || NAV_MORE.includes(tab)) ? prefs.accentColor : '#767676' }}>
            <Icon name="dots" size={19} />
            <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>More</span>
          </button>
        </nav>
        {overlays}
      </div>
    </AccentColorContext.Provider>
  );
}
