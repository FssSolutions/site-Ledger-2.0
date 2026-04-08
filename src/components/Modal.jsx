import Icon from './Icon.jsx';
import { ib } from '../styles.js';

export function Modal({ children, onClose }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 430, background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 24px 44px', border: '1px solid #e8e8e8', borderBottom: 'none', maxHeight: '90vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111' }}>{title}</div>
        {subtitle && <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button onClick={onClose} style={{ ...ib, background: '#f0f0f0', borderRadius: 8, padding: 8, color: '#888' }}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
