import { useEffect, useState } from 'react';
import { DEFAULT_OT_RULES } from '../lib/overtime.js';

// Device preferences (not account data). Stored in localStorage; reads and
// writes tolerate storage being unavailable.
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* preference not persisted */ }
}

export function usePrefs() {
  const [accentColor, setAccentColor] = useState(() => read('sl_accent_color', '#E8651A'));
  const [taxRate, setTaxRate] = useState(() => {
    const n = Number(read('sl_tax_rate', '5'));
    return Number.isFinite(n) ? n : 5;
  });
  const [reminderTime, setReminderTime] = useState(() => read('sl_reminder_time', ''));
  const [otEnabled, setOtEnabled] = useState(() => read('sl_ot_enabled', '1') === '1');

  useEffect(() => write('sl_accent_color', accentColor), [accentColor]);
  useEffect(() => write('sl_tax_rate', String(taxRate)), [taxRate]);
  useEffect(() => write('sl_reminder_time', reminderTime), [reminderTime]);
  useEffect(() => write('sl_ot_enabled', otEnabled ? '1' : '0'), [otEnabled]);

  return {
    accentColor, setAccentColor, taxRate, setTaxRate, reminderTime, setReminderTime,
    otEnabled, setOtEnabled, otRules: { ...DEFAULT_OT_RULES, enabled: otEnabled },
  };
}
