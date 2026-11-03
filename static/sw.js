// Service worker: makes the portal installable and opens instantly from the home screen.
// Network first (so every deploy shows up right away), cached copy only when offline.
// /api/* (customer data and documents) is never cached.
const CACHE = 'visa-portal-v1';
const SHELL = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request.mode === 'navigate' ? '/' : event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request.mode === 'navigate' ? '/' : event.request)),
  );
});
