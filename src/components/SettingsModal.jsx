import { Modal, ModalHeader } from './Modal.jsx';
import { inp, lbl } from '../styles.js';

const PRESETS = [
  '#E8651A', '#3B82F6', '#10B981', '#8B5CF6',
  '#EF4444', '#F59E0B', '#06B6D4', '#EC4899',
  '#111111',
];

export default function SettingsModal({ accentColor, onAccentChange, taxRate, onTaxChange, onClose }) {
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

      <div style={{ marginBottom: 8 }}>
        <label style={lbl}>Tax Rate (GST %)</label>
        <input
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
          Applied to generated invoices. BC default is 5% (GST).
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
