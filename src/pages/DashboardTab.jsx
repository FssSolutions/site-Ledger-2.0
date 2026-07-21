import { useState, useEffect, useMemo } from 'react';
import Icon from '../components/Icon.jsx';
import { card } from '../styles.js';
import { fmtDur, fmtCAD, calcEarnings, calcDur, dayKey } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

export default function DashboardTab({ jobs, employees, sessions, company, active, breakState, onGoTo, isDesktop }) {
  const accent = useAccentColor();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const now = new Date();
  const todayKey = dayKey(now);
  const weekStartMs = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime();
  })();
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const todaySessions = useMemo(() => sessions.filter(s => dayKey(s.start_time) === todayKey), [sessions, todayKey]);
  const weekSessions = useMemo(() => sessions.filter(s => new Date(s.start_time).getTime() >= weekStartMs), [sessions, weekStartMs]);
  const monthSessions = useMemo(() => sessions.filter(s => new Date(s.start_time).getTime() >= monthStartMs), [sessions, monthStartMs]);

  const todayMs = todaySessions.reduce((a, s) => a + calcDur(s), 0);
  const todayEarn = todaySessions.reduce((a, s) => a + calcEarnings(s, jobs, employees, company), 0);
  const weekMs = weekSessions.reduce((a, s) => a + calcDur(s), 0);
  const weekEarn = weekSessions.reduce((a, s) => a + calcEarnings(s, jobs, employees, company), 0);

  const activeElapsed = active ? (() => {
    const start = new Date(active.start_time).getTime();
    const effective = breakState?.pausedAt ? breakState.pausedAt : Date.now();
    return Math.max(0, effective - start - (breakState?.totalBreakMs || 0));
  })() : 0;
  const activeJob = active ? jobs.find(j => j.id === active.job_id) : null;
  const activeEmp = active ? employees.find(e => e.id === active.employee_id) : null;

  const topJobs = useMemo(() => {
    const byJob = {};
    monthSessions.forEach(s => { byJob[s.job_id] = (byJob[s.job_id] || 0) + calcDur(s); });
    return Object.entries(byJob)
      .map(([id, ms]) => ({ job: jobs.find(j => j.id === id), ms }))
      .filter(x => x.job)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 4);
  }, [monthSessions, jobs]);
  const topJobsMax = topJobs[0]?.ms || 1;

  const hasEmployees = employees.length > 0;
  const monthBilled = monthSessions.reduce((a, s) => a + calcEarnings(s, jobs, [], company), 0);
  const monthLabour = monthSessions.reduce((a, s) => a + calcEarnings(s, jobs, employees, company), 0);
  const monthProfit = monthBilled - monthLabour;

  const recent = useMemo(() => [...sessions].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).slice(0, 3), [sessions]);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateStr = `${MN[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: '#999', fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>{dateStr}</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: '#111', letterSpacing: -0.5, marginTop: 2 }}>{greeting}</div>
        </div>
        {!active && (
          <button onClick={() => onGoTo('clock')}
            style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="clock" size={14} /> Clock In
          </button>
        )}
      </div>

      {/* Active session card */}
      {active && (
        <div style={{ ...card, margin: '0 16px 12px', padding: '16px 20px', background: `${accent}12`, border: `1.5px solid ${accent}33` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: 1, color: accent, fontWeight: 700, marginBottom: 4 }}>● ACTIVE SESSION</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeJob?.name || 'Unknown Job'}</div>
              {activeEmp && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{activeEmp.name}</div>}
              {breakState?.pausedAt && <div style={{ fontSize: 11, color: '#E67E22', marginTop: 2, fontFamily: "'DM Mono', monospace" }}>ON BREAK</div>}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: accent }}>{fmtDur(activeElapsed)}</div>
              <button onClick={() => onGoTo('clock')} style={{ marginTop: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${accent}`, background: 'transparent', color: accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Go to Clock</button>
            </div>
          </div>
        </div>
      )}

      {/* Today / This Week stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 16px 12px' }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: '#999', fontFamily: "'DM Mono', monospace", letterSpacing: 0.5, marginBottom: 6 }}>TODAY</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#111' }}>{fmtDur(todayMs)}</div>
          <div style={{ fontSize: 13, color: accent, fontWeight: 600, marginTop: 2 }}>{fmtCAD(todayEarn)}</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: '#999', fontFamily: "'DM Mono', monospace", letterSpacing: 0.5, marginBottom: 6 }}>THIS WEEK</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#111' }}>{fmtDur(weekMs)}</div>
          <div style={{ fontSize: 13, color: accent, fontWeight: 600, marginTop: 2 }}>{fmtCAD(weekEarn)}</div>
        </div>
      </div>

      {/* Top jobs this month */}
      {topJobs.length > 0 && (
        <div style={{ ...card, margin: '0 16px 12px', padding: '18px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111', fontFamily: "'Syne', sans-serif", marginBottom: 14 }}>This Month · Top Jobs</div>
          {topJobs.map(({ job, ms }) => (
            <div key={job.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: job.color || accent, flexShrink: 0 }} />
                  {job.name}
                </div>
                <div style={{ fontSize: 12, color: '#888', fontFamily: "'DM Mono', monospace" }}>{fmtDur(ms)}</div>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: '#f0f0f0' }}>
                <div style={{ height: 5, borderRadius: 3, background: job.color || accent, width: `${(ms / topJobsMax) * 100}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profit snapshot */}
      {hasEmployees && monthSessions.length > 0 && (
        <div style={{ ...card, margin: '0 16px 12px', padding: '18px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111', fontFamily: "'Syne', sans-serif", marginBottom: 12 }}>This Month · Profit</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: '#999', fontFamily: "'DM Mono', monospace", letterSpacing: 0.5, marginBottom: 3 }}>BILLED</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{fmtCAD(monthBilled)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#999', fontFamily: "'DM Mono', monospace", letterSpacing: 0.5, marginBottom: 3 }}>LABOUR</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{fmtCAD(monthLabour)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#999', fontFamily: "'DM Mono', monospace", letterSpacing: 0.5, marginBottom: 3 }}>PROFIT</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: monthProfit >= 0 ? '#1e8449' : '#C0392B' }}>
                {monthProfit >= 0 ? '+' : ''}{fmtCAD(monthProfit)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent sessions */}
      {recent.length > 0 && (
        <div style={{ ...card, margin: '0 16px 12px', padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111', fontFamily: "'Syne', sans-serif" }}>Recent Sessions</div>
            <button onClick={() => onGoTo('calendar')} style={{ fontSize: 11, color: accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>See all</button>
          </div>
          {recent.map(s => {
            const j = jobs.find(x => x.id === s.job_id);
            const e = employees.find(x => x.id === s.employee_id);
            return (
              <div key={s.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f4f4f4', alignItems: 'center' }}>
                <div style={{ width: 3, minHeight: 30, borderRadius: 2, background: j?.color || accent, flexShrink: 0, alignSelf: 'stretch' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {j?.name || '—'}{e ? <span style={{ color: '#aaa', fontWeight: 400 }}> · {e.name}</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                    {new Date(s.start_time).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} · {fmtDur(calcDur(s))}
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111', flexShrink: 0 }}>{fmtCAD(calcEarnings(s, jobs, employees, company))}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {sessions.length === 0 && !active && (
        <div style={{ ...card, margin: '0 16px', padding: '40px 24px', textAlign: 'center' }}>
          <Icon name="clock" size={40} />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111', fontFamily: "'Syne', sans-serif", marginBottom: 6, marginTop: 12 }}>Welcome to SiteLedger</div>
          <div style={{ fontSize: 13, color: '#999', marginBottom: 20 }}>Clock in to your first job to get started.</div>
          <button onClick={() => onGoTo('clock')} style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Clock In
          </button>
        </div>
      )}

    </div>
  );
}
