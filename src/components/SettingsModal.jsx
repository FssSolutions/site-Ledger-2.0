import { useId } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl } from '../styles.js';
import { SUPPORT_EMAIL } from '../lib/constants.js';

const PRESETS = [
  '#E8651A', '#3B82F6', '#10B981', '#8B5CF6',
  '#EF4444', '#F59E0B', '#06B6D4', '#EC4899',
  '#111111',
];

export default function SettingsModal({ prefs, onClose }) {
  const id = useId();
  const { accentColor, setAccentColor: onAccentChange, taxRate, setTaxRate: onTaxChange, reminderTime, setReminderTime: onReminderChange, otEnabled, setOtEnabled } = prefs;
  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Settings" subtitle="Personalize your SiteLedger" onClose={onClose} />

      <div style={{ marginBottom: 24 }}>
        <label style={lbl}>Accent Color</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
          {PRESETS.map(c => {
            const selected = c.toLowerCase() === (accentColor || '').toLowerCase();
            return (
              <button
                key={c}
                onClick={() => onAccentChange(c)}
                aria-label={`Accent ${c}`}
                style={{
                  width: '100%', aspectRatio: '1 / 1', borderRadius: 12,
                  border: selected ? '3px solid #111' : '1px solid #e0e0e0',
                  background: c, cursor: 'pointer', padding: 0,
                  boxShadow: selected ? '0 0 0 2px #fff inset' : 'none',
                }}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="color"
            value={accentColor}
            onChange={e => onAccentChange(e.target.value)}
            style={{ width: 44, height: 40, border: '1px solid #e0e0e0', borderRadius: 10, padding: 2, background: '#fff', cursor: 'pointer' }}
          />
          <input
            type="text"
            value={accentColor}
            onChange={e => onAccentChange(e.target.value)}
            placeholder="#E8651A"
            style={{ ...inp, flex: 1, fontFamily: "'DM Mono', monospace" }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label htmlFor={`${id}-rem`} style={lbl}>Clock-Out Reminder</label>
        <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>Shows an alert if you're still clocked in after this time. It only works while SiteLedger is open on screen — it is not a phone notification and will not fire when the app is closed or the phone is locked.</div>
        <input
          id={`${id}-rem`}
          type="time"
          value={reminderTime || ''}
          onChange={e => onReminderChange(e.target.value)}
          style={inp}
        />
        {reminderTime && (
          <button onClick={() => onReminderChange('')}
            style={{ marginTop: 6, fontSize: 12, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Clear reminder
          </button>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor={`${id}-tax`} style={lbl}>Tax Rate (GST %)</label>
        <input
          id={`${id}-tax`}
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={Number.isFinite(taxRate) ? taxRate : ''}
          onChange={e => {
            const v = parseFloat(e.target.value);
            onTaxChange(Number.isFinite(v) ? v : 0);
          }}
          style={inp}
        />
        <div style={{ color: '#aaa', fontSize: 11, marginTop: 6 }}>
          Applied to new invoices (rounded once on the subtotal, to the cent). Recorded invoices keep the rate they were issued with. GST is 5%.
        </div>
      </div>

      <div style={{ marginBottom: 8, marginTop: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#333', cursor: 'pointer' }}>
          <input type="checkbox" checked={otEnabled} onChange={e => setOtEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
          Show overtime flags
        </label>
        <div style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
          Per worker, BC rules: over 8 h a day (double over 12 h), over 40 h in a Sunday–Saturday week not already counted daily. These are reminders, not payroll calculations.
        </div>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
        <div style={{ color: '#111', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Help and support</div>
        <div style={{ color: '#666', fontSize: 13, lineHeight: 1.6 }}>
          Questions or a problem? Email <a href={`mailto:${SUPPORT_EMAIL}?subject=SiteLedger%20support`} style={{ color: accentColor || '#E8651A', fontWeight: 600 }}>{SUPPORT_EMAIL}</a>.
        </div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: '#777' }}>Privacy Policy</a>{' · '}<a href="/terms.html" target="_blank" rel="noopener" style={{ color: '#777' }}>Terms of Use</a>
        </div>
      </div>

      <button
        onClick={onClose}
        style={{ width: '100%', marginTop: 20, padding: '14px', borderRadius: 12, border: 'none', background: accentColor || '#E8651A', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif" }}
      >
        Done
      </button>
    </Modal>
  );
}
