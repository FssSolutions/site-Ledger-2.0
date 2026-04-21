import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { card, ib, inp, lbl } from '../styles.js';
import { fmtCAD, todayStr } from '../lib/utils.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

const CATEGORIES = ['materials', 'tools', 'fuel', 'subcontractor', 'other'];
const CAT_LABELS = { materials: 'Materials', tools: 'Tools', fuel: 'Fuel', subcontractor: 'Sub', other: 'Other' };
const CAT_COLORS = { materials: '#2E86AB', tools: '#A23B72', fuel: '#F18F01', subcontractor: '#1B998B', other: '#888' };

export default function ExpensesTab({ jobs, expenses, onAdd, onDelete, isDesktop }) {
  const accent = useAccentColor();
  const activeJobs = jobs.filter(j => (j.status || 'active') === 'active');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ jobId: activeJobs[0]?.id || '', date: todayStr(), description: '', amount: '', category: 'materials' });

  const totalExpenses = expenses.reduce((s, x) => s + Number(x.amount), 0);

  function submit() {
    if (!form.amount || !form.jobId || !form.description) return;
    onAdd({ job_id: form.jobId, date: form.date, description: form.description, amount: parseFloat(form.amount), category: form.category });
    setForm({ jobId: activeJobs[0]?.id || '', date: todayStr(), description: '', amount: '', category: 'materials' });
    setShowAdd(false);
  }

  function exportCSV() {
    const rows = [['Date', 'Job', 'Description', 'Category', 'Amount (CAD)']];
    expenses.forEach(e => {
      const j = jobs.find(x => x.id === e.job_id);
      rows.push([e.date, j?.name || '', e.description || '', CAT_LABELS[e.category] || e.category, Number(e.amount).toFixed(2)]);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'expenses-log.csv';
    a.click();
  }

  return (
    <div style={{ padding: isDesktop ? '0 0 24px' : '0 0 100px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '16px 16px 0' }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Total Spent</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#C0392B' }}>{fmtCAD(totalExpenses)}</div>
        </div>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ color: '#999', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Entries</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{expenses.length}</div>
        </div>
      </div>

      <div style={{ margin: '12px 16px 0' }}>
        <button onClick={() => setShowAdd(!showAdd)} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px dashed #ddd', background: 'transparent', color: '#888', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={14} /> Log Expense
        </button>
      </div>

      {showAdd && (
        <div style={{ ...card, margin: '12px 16px 0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={lbl}>Job</label>
              <select value={form.jobId} onChange={e => setForm({ ...form, jobId: e.target.value })} style={inp}>
                {activeJobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Date</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></div>
            <div><label style={lbl}>Description</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. 2x4 lumber, 10 pcs" style={inp} /></div>
            <div><label style={lbl}>Amount (CAD)</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 125.50" style={inp} /></div>
            <div>
              <label style={lbl}>Category</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setForm({ ...form, category: c })}
                    style={{ padding: '6px 12px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: form.category === c ? CAT_COLORS[c] : '#f0f0f0', color: form.category === c ? '#fff' : '#888' }}>
                    {CAT_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submit} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save Expense</button>
              <button onClick={() => setShowAdd(false)} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #e0e0e0', background: 'transparent', color: '#888', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {expenses.length > 0 && (
        <div style={{ margin: '16px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ color: '#bbb', fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 2, textTransform: 'uppercase' }}>Expenses</div>
            <button onClick={exportCSV} style={{ ...ib, color: '#888', fontSize: 12, gap: 4 }}><Icon name="dl" size={13} /> Export</button>
          </div>
          {[...expenses].reverse().map(exp => {
            const j = jobs.find(x => x.id === exp.job_id);
            return (
              <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: j?.color || '#ccc', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 600 }}>{exp.description}</div>
                  <div style={{ color: '#aaa', fontSize: 12 }}>
                    {exp.date} · {j?.name || 'Unknown'} · <span style={{ color: CAT_COLORS[exp.category] || '#aaa' }}>{CAT_LABELS[exp.category] || exp.category}</span>
                  </div>
                </div>
                <div style={{ color: '#C0392B', fontSize: 13, fontWeight: 600, marginRight: 4 }}>{fmtCAD(Number(exp.amount))}</div>
                <button onClick={() => { if (confirm('Delete this expense?')) onDelete(exp.id); }} style={{ ...ib, color: '#e74c3c' }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {expenses.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 14 }}>No expenses logged yet.</div>
      )}
    </div>
  );
}
