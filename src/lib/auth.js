const LS = 'sl_auth_v4';

export function loadAuth() {
  try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; }
}

export function saveAuth(d) {
  try { localStorage.setItem(LS, JSON.stringify(d)); } catch {}
}

export function clearAuth() {
  try { localStorage.removeItem(LS); } catch {}
}
