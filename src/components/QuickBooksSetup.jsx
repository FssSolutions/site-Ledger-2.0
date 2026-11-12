import { useEffect, useId, useRef, useState } from 'react';
import { inp, lbl } from '../styles.js';
import { useAccentColor } from '../lib/AccentColorContext.js';
import { loadQboOptions, saveQboSettings, taxCodeLabel } from '../lib/qboApi.js';

const note = { color: '#777', fontSize: 12, lineHeight: 1.5 };

// One-time invoice setup: which QuickBooks items and tax code SiteLedger puts
// on invoice lines. The lists come from the connected QuickBooks company.
// onDone(saved) is called when the form closes; onReconnect when QuickBooks
// access turns out to have expired.
export default function QuickBooksSetup({ uid, taxRate, toast, onDone, onReconnect }) {
  const accent = useAccentColor();
  const id = useId();
  const [phase, setPhase] = useState('loading'); // loading | error | ready
  const [error, setError] = useState('');
  const [opts, setOpts] = useState({ items: [], taxCodes: [] });
  const [form, setForm] = useState({ labour_item_id: '', half_day_item_id: '', full_day_item_id: '', tax_code_id: '' });
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function load() {
    setPhase('loading');
    const r = await loadQboOptions(uid);
    if (!alive.current) return;
    if (!r.ok) {
      if (r.code === 'reconnect' || r.code === 'not_connected') { onReconnect?.(); return; }
      setError(r.error);
      setPhase('error');
      return;
    }
    const items = r.data?.items || [];
    const taxCodes = r.data?.taxCodes || [];
    const sel = r.data?.selected || {};
    const has = (list, v) => (v && list.some(x => x.id === v) ? v : '');
    setOpts({ items, taxCodes });
    setForm({
      labour_item_id: has(items, sel.labour_item_id),
      half_day_item_id: has(items, sel.half_day_item_id),
      full_day_item_id: has(items, sel.full_day_item_id),
      tax_code_id: has(taxCodes, sel.tax_code_id),
    });
    setPhase('ready');
  }
  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!form.labour_item_id || !form.tax_code_id || saving) return;
    setSaving(true);
    const r = await saveQboSettings(uid, {
      labour_item_id: form.labour_item_id,
      half_day_item_id: form.half_day_item_id || null,
      full_day_item_id: form.full_day_item_id || null,
      tax_code_id: form.tax_code_id,
    });
    if (!alive.current) return;
    setSaving(false);
    if (!r.ok) {
      if (r.code === 'reconnect' || r.code === 'not_connected') { onReconnect?.(); return; }
      toast?.(r.error);
      return;
    }
    toast?.('QuickBooks invoice setup saved.', 'success');
    onDone?.(true);
  }

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const link = { color: accent, background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12 };

  if (phase === 'loading') return <div style={note}>Reading items and tax codes from QuickBooks…</div>;
  if (phase === 'error') {
    return (
      <div style={note} role="alert">
        {error}{' '}
        <button type="button" onClick={load} style={link}>Try again</button>{' · '}
        <button type="button" onClick={() => onDone?.(false)} style={link}>Cancel</button>
      </div>
    );
  }

  const taxCode = opts.taxCodes.find(t => t.id === form.tax_code_id);
  const previewRate = Number(taxRate);
  const rateDiffers = taxCode && taxCode.rate != null && Number.isFinite(previewRate) && Number(taxCode.rate) !== previewRate;
  const itemSelect = (key, labelText, optional) => (
    <div>
      <label htmlFor={`${id}-${key}`} style={lbl}>{labelText}</label>
      <select id={`${id}-${key}`} value={form[key]} onChange={set(key)} style={inp}>
        <option value="">{optional ? 'Same as hourly labour' : 'Choose an item…'}</option>
        {opts.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={note}>
        Choose what SiteLedger puts on each invoice line in QuickBooks. These come from your QuickBooks company; to add one, create it in QuickBooks (Sales → Products and services), then{' '}
        <button type="button" onClick={load} style={link}>refresh this list</button>.
      </div>

      {opts.items.length === 0 && <div style={{ ...note, color: '#a93226' }} role="alert">No service items were found in QuickBooks. Add one there (for example &ldquo;Labour&rdquo;), then refresh this list.</div>}
      {opts.taxCodes.length === 0 && <div style={{ ...note, color: '#a93226' }} role="alert">No sales tax codes were found in QuickBooks. Set up sales tax there (Taxes → Sales tax), then refresh this list.</div>}

      {itemSelect('labour_item_id', 'Item for hourly labour', false)}
      {itemSelect('half_day_item_id', 'Item for half-day rate', true)}
      {itemSelect('full_day_item_id', 'Item for full-day rate', true)}

      <div>
        <label htmlFor={`${id}-tax`} style={lbl}>Tax code on labour</label>
        <select id={`${id}-tax`} value={form.tax_code_id} onChange={set('tax_code_id')} style={inp}>
          <option value="">Choose a tax code…</option>
          {opts.taxCodes.map(t => <option key={t.id} value={t.id}>{taxCodeLabel(t)}</option>)}
        </select>
        {rateDiffers && (
          <div style={{ ...note, color: '#9a4a10', marginTop: 6 }}>
            This code charges {Number(taxCode.rate)}%, but SiteLedger&rsquo;s preview tax rate (Settings) is {previewRate}%. QuickBooks decides the tax on the invoice.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={save} disabled={!form.labour_item_id || !form.tax_code_id || saving}
          style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: accent, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: !form.labour_item_id || !form.tax_code_id || saving ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save setup'}
        </button>
        <button type="button" onClick={() => onDone?.(false)} disabled={saving} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', color: '#666', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
