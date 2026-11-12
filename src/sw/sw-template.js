// SiteLedger service worker (generated at build time from src/sw/sw-template.js).
//
// * Precaches the complete app shell for this build (HTML, JS, CSS, icons,
//   lazy-loaded screens) so the app opens with no connection.
// * Never caches or intercepts Supabase traffic (auth, REST, functions) or any
//   other cross-origin request except Google Fonts.
// * A new version installs in the background and waits; the page asks the user
//   before activating it. Offline data lives in IndexedDB, not in this cache,
//   so updating or clearing this cache never touches pending work.

const VERSION = '__VERSION__';
const SHELL = `sl-shell-${VERSION}`;
const FONTS = 'sl-fonts-v1';
const PRECACHE = __PRECACHE__;
const STANDALONE_PAGES = ['/privacy.html', '/terms.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: 'reload' bypasses the HTTP cache so the shell matches this build.
    await cache.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })));
    // First install: nothing to wait for.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sl-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return; // Supabase and everything else: untouched

  // Standalone pages (privacy policy, terms): serve the page itself, from the
  // precache when offline, instead of the app shell.
  if (req.mode === 'navigate' && STANDALONE_PAGES.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match(url.pathname, { ignoreVary: true, ignoreSearch: true })) || fetch(req);
    })());
    return;
  }

  if (req.mode === 'navigate') {
    // App shell first: opens instantly in a basement. Updates arrive through
    // the service-worker update cycle, not by refetching the page.
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match('/index.html', { ignoreVary: true })) || (await cache.match('/', { ignoreVary: true })) || fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    // ignoreVary: module scripts are requested with an Origin header
    // (crossorigin), and servers often send "Vary: Origin".
    const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: url.pathname.startsWith('/assets/') });
    if (hit) return hit;
    return fetch(req);
  })());
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const update = fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || update;
}
