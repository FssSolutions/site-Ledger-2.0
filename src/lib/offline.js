const CACHE_KEY = 'sl_data_cache';
const QUEUE_KEY = 'sl_offline_queue';

// --- Data cache ---
export function cacheData(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() })); } catch {}
}

export function loadCachedData() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

// --- Offline mutation queue ---
export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}

function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
}

export function enqueue(op) {
  const q = getQueue();
  q.push({ ...op, id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ts: Date.now() });
  saveQueue(q);
}

export function clearQueue() {
  saveQueue([]);
}

export function removeFromQueue(id) {
  saveQueue(getQueue().filter(op => op.id !== id));
}

// --- Online detection ---
export function isOnline() {
  return navigator.onLine;
}
