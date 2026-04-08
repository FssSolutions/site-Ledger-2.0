import { useState, useEffect } from 'react';

export default function Toast({ message, type, onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); setTimeout(onDone, 300); }, 4000);
    return () => clearTimeout(t);
  }, []);

  const bg = type === 'error' ? '#c0392b' : type === 'success' ? '#27ae60' : '#E8651A';

  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      maxWidth: 400, width: 'calc(100% - 32px)', zIndex: 2000,
      background: bg, color: '#fff', padding: '14px 20px', borderRadius: 12,
      fontSize: 14, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      opacity: visible ? 1 : 0, transition: 'opacity 0.3s',
    }}>
      {message}
    </div>
  );
}
