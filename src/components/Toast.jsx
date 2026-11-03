import { useState, useEffect, useRef } from 'react';

export default function Toast({ message, type, onDone }) {
  const [visible, setVisible] = useState(true);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // Errors stay longer so they can be read.
    const t = setTimeout(() => { setVisible(false); setTimeout(() => done.current(), 300); }, type === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [type]);

  const bg = type === 'error' ? '#a93226' : type === 'success' ? '#1e7a46' : '#9a4a10';

  return (
    <div role={type === 'error' ? 'alert' : 'status'} onClick={() => setVisible(false)} style={{
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
