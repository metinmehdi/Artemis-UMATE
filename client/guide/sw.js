// Offline support for the real-trip guide: the app, its fonts, photos and trip data are kept on the
// phone after the first visit, so the step cards, Remind me, breathing, calling and the staff card
// work underground without signal. The API (Buddy, photos, the trip log) is never cached.
const VERSION = 'umate-guide-v1';
const SHELL = [
  '/guide/',
  '/guide/guide.css',
  '/guide/guide.js',
  '/guide/manifest.webmanifest',
  '/assets/brand.css',
  '/assets/fonts/fonts.css',
  '/assets/fonts/lexend.woff2',
  '/assets/fonts/fraunces-soft.woff2',
  '/assets/brand/umate-logo.svg',
  '/assets/brand/favicon.svg',
  '/assets/brand/icon-192.png',
  '/assets/guide/topup.jpg',
  '/assets/guide/gate.jpg',
  '/assets/guide/platform.jpg',
  '/assets/guide/ride.jpg',
  '/data/city/baku/network.json',
  '/data/city/baku/rules.json',
  '/data/scenario/metro-trip.json',
  '/shared/data.js',
  '/shared/engine.js',
  '/shared/runtime.js',
  '/shared/companion.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { credentials: 'include' })))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('umate-guide-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (always the latest version when online), cache as the fallback offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(url.pathname === '/guide/index.html' ? '/guide/' : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/guide/') : Response.error()))),
  );
});
