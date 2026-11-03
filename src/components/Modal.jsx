import { createContext, useContext, useEffect, useId, useRef } from 'react';
import Icon from './Icon.jsx';
import { ib } from '../styles.js';

const TitleId = createContext(null);
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ children, onClose, labelledBy }) {
  const id = useId();
  const titleId = labelledBy || `${id}-title`;
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const el = panel.current;
    const first = el?.querySelector('[data-autofocus]') || el?.querySelector(FOCUSABLE);
    (first || el)?.focus();
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) return;
      const firstItem = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ width: '100%', maxWidth: 430, background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 24px 44px', border: '1px solid #e8e8e8', borderBottom: 'none', maxHeight: '90vh', overflowY: 'auto', outline: 'none' }}>
        <TitleId.Provider value={titleId}>{children}</TitleId.Provider>
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose }) {
  const titleId = useContext(TitleId);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
      <div>
        <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Syne', sans-serif", color: '#111', margin: 0 }}>{title}</h2>
        {subtitle && <div style={{ color: '#777', fontSize: 13, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" style={{ ...ib, background: '#f0f0f0', borderRadius: 8, padding: 8, color: '#666' }}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

// Confirmation dialog that replaces window.confirm for consequential choices.
export function ConfirmDialog({ title, message, actions, onClose }) {
  return (
    <Modal onClose={onClose}>
      <ModalHeader title={title} onClose={onClose} />
      <div style={{ color: '#444', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>{message}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.map(a => (
          <button key={a.label} type="button" onClick={a.onClick} data-autofocus={a.autoFocus ? '' : undefined}
            style={{ padding: '13px', borderRadius: 10, border: a.primary ? 'none' : '1px solid #ddd', background: a.danger ? '#c0392b' : a.primary ? '#222' : '#fff', color: a.primary || a.danger ? '#fff' : '#333', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
