import { useId, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { fmtCAD, toCents } from '../lib/billing.js';
import { todayKey } from '../lib/time.js';
import { toCsv, downloadText } from '../lib/csv.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

const CATEGORIES = ['materials', 'tools', 'fuel', 'subcontractor', 'other'];
const CAT_LABELS = { materials: 'Materials', tools: 'Tools', fuel: 'Fuel', subcontractor: 'Sub', other: 'Other' };
const CAT_COLORS = { materials: '#1B6C8F', tools: '#8A2F5F', fuel: '#A35A10', subcontractor: '#137A6F', other: '#666' };

export default function ExpensesTab({ jobs, expenses, onAdd, onDelete, isDesktop }) {
  const accent = useAccentColor();
  const id = useId();
  const activeJobs = jobs.filter(j => (j.status || 'active') === 'active');
  const blank = () => ({ jobId: activeJobs[0]?.id || '', date: todayKey(), description: '', amount: '', category: 'materials' });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const totalCents = expenses.reduce((s, x) => s + toCents(x.amount), 0);

  async function submit(e) {
    e.preventDefault();
    if (saving || !form.amount || !form.description) return;
    setSaving(true);
    const r = await onAdd({ job_id: form.jobId || null, date: form.date, description: form.description, amount: form.amount, category: form.category });
    setSaving(false);
    if (r?.ok) { setForm(blank()); setShowAdd(false); }
  }

  function exportCSV() {
    const rows = [['Date', 'Job', 'Description', 'Category', 'Amount (CAD)']];
    [...expenses].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(e => {
      const j = jobs.find(x => x.id === e.job_id);
      rows.push([e.date, j?.name || '', e.description || '', CAT_LABELS[e.category] || e.category || '', toCents(e.amount) / 100]);
    });
    downloadText('expenses-log.csv', toCsv(rows, { numericCols: [4] }));
  }

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '16px 16px 0' }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Total Spent</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#A93226' }}>{fmtCAD(totalCents)}</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#666', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Entries</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{expenses.length}</div>
        </div>
      </div>

      <div style={{ margin: '12px 16px 0' }}>
        <button type="button" onClick={() => setShowAdd(!showAdd)} aria-expanded={showAdd} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px dashed #ccc', background: 'transparent', color: '#555', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={14} /> Log Expense
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
          <div><label htmlFor={`${id}-desc`} style={lbl}>Description</label><input id={`${id}-desc`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. 2x4 lumber, 10 pcs" style={inp} required /></div>
          <div><label htmlFor={`${id}-amt`} style={lbl}>Amount (CAD)</label><input id={`${id}-amt`} type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 125.50" style={inp} required /></div>
          <div role="group" aria-labelledby={`${id}-cat`}>
            <div id={`${id}-cat`} style={lbl}>Category</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => setForm({ ...form, category: c })} aria-pressed={form.category === c}
                  style={{ padding: '8px 12px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: form.category === c ? CAT_COLORS[c] : '#f0f0f0', color: form.category === c ? '#fff' : '#555' }}>
                  {CAT_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save Expense'}</button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #ddd', background: 'transparent', color: '#555', cursor: 'pointer' }}>Cancel</button>
          </div>
        </form>
      )}

      {expenses.length > 0 && (
        <section aria-label="Expenses" style={{ margin: '16px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ color: '#777', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase' }}>Expenses</div>
            <button type="button" onClick={exportCSV} style={{ ...ib, color: '#555', fontSize: 12, gap: 4, padding: 8 }}><Icon name="dl" size={13} /> Export</button>
          </div>
          {[...expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).map(exp => {
            const j = jobs.find(x => x.id === exp.job_id);
            return (
              <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: j?.color || '#ccc', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>{exp.description}{exp._sync && exp._sync !== 'synced' ? <span style={{ color: '#a35a10', fontSize: 11, fontWeight: 400 }}> · not synced</span> : null}</div>
                  <div style={{ color: '#777', fontSize: 12 }}>
                    {exp.date} · {j?.name || 'General'} · <span style={{ color: CAT_COLORS[exp.category] || '#666' }}>{CAT_LABELS[exp.category] || exp.category}</span>
                  </div>
                </div>
                <div style={{ color: '#A93226', fontSize: 13, fontWeight: 600, marginRight: 4 }}>{fmtCAD(toCents(exp.amount))}</div>
                <button type="button" aria-label="Delete expense" onClick={() => { if (window.confirm('Delete this expense?')) onDelete(exp.id); }} style={{ ...ib, color: '#c0392b', padding: 8 }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </section>
      )}

      {expenses.length === 0 && !showAdd && <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 14 }}>No expenses logged yet.</div>}
    </div>
  );
}
