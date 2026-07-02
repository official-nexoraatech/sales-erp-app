/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'pos-v1';
const CATALOG_CACHE = 'pos-catalog-v1';
const STATIC_ASSETS = ['/', '/index.html'];

const CACHEABLE_PATHS = [
  '/api/v2/pos/quick-items',
  '/api/v2/pos/customer-search',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== CATALOG_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isCatalogRequest = CACHEABLE_PATHS.some((p) => url.pathname.includes(p));

  if (isCatalogRequest) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CATALOG_CACHE).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached ?? new Response('{}', { status: 503 })))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html').then((cached) => cached ?? new Response('Offline', { status: 503 }))
      )
    );
  }
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string })?.type === 'SYNC_PENDING') {
    event.waitUntil(syncPendingTransactions());
  }
});

async function syncPendingTransactions(): Promise<void> {
  // Signal to main thread that sync is requested — actual sync runs in POSScreen
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'DO_SYNC' });
  });
}
