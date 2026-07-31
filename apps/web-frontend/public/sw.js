// CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) — a deliberately minimal service worker: just
// enough for a browser's install-prompt eligibility check (a registered SW with a real fetch
// handler) and a basic "app shell still opens if the network is down" fallback. This is NOT an
// offline-data-sync layer — that's Phase 4's Field Sales feature, a different, much larger
// scope (real request queuing/conflict resolution). Runtime-caches whatever it fetches rather
// than precaching a build-hashed asset list, so it needs no Vite-build integration.
const CACHE_NAME = 'nexoraa-erp-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only GET is cacheable — every write (POST/PUT/PATCH/DELETE) always goes straight to the
  // network, untouched. This app has no offline-write story yet (see the header comment).
  if (request.method !== 'GET') return;

  // Cross-origin (API calls to the gateway on a different port/origin in dev, or any other
  // service) are left alone — this shell cache is for this origin's own static assets/pages
  // only, never a silent cache of API responses.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/')))
  );
});
