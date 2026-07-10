/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { runBackgroundSync } from './swSync.js';

// OFFLINE-06: minimal Background Sync event shape — not in TypeScript's shipped webworker
// lib. This file is excluded from the tsc project (see tsconfig.json) since its global
// scope conflicts with the rest of the app's DOM lib, so this is documentation more than
// a type-check gate; esbuild (Vite's bundler for this entry) strips types without checking.
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

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

// OFFLINE-06: real Background Sync handler, replacing the old SYNC_PENDING/DO_SYNC
// message-passing scaffold (confirmed dead — nothing ever posted SYNC_PENDING to the SW).
// Fires even if the tab that queued the sale has since closed, as long as the browser
// supports Background Sync (Chromium/Android; no Safari/iOS) — POSScreen.tsx's tab-open
// triggers (window.online, manual "Sync now") remain the fallback everywhere else.
self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag !== 'sync-pending-sales') return;

  syncEvent.waitUntil(
    runBackgroundSync().then(async (result) => {
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({ type: 'BACKGROUND_SYNC_DONE', ...result });
      });
    })
  );
});
