# OFFLINE-06 Completion Report — Background Sync & Status UI
**Date:** 2026-07-05
**Status:** COMPLETE

## What Changed

### Background Sync registration + SW handler
- `sw.ts`'s dead `SYNC_PENDING`/`DO_SYNC` message-passing scaffold (confirmed still unreachable — nothing ever posted `SYNC_PENDING` to the SW) is removed and replaced with a real `self.addEventListener('sync', ...)` handler for tag `sync-pending-sales`.
- `POSScreen.tsx` registers the tag (`registerBackgroundSync()`, feature-detected via `'serviceWorker' in navigator && 'SyncManager' in window`) after queueing a sale or customer offline, and again once at mount (covers a device with leftover pending items from a previous session that closed before it could register).
- Where Background Sync isn't supported (Safari/iOS, and any browser without it), the existing `window.online` listener and manual "Sync now" button are unchanged and remain the only sync path.

### New shared sync core (`swSync.ts`)
The service worker has no `localStorage`/`window` access, so it can't reuse `auth.ts`'s `authFetch`/token storage directly. Rather than re-implement the queue/dedupe logic a second time (the part that actually prevents duplicate invoices), `swSync.ts` reuses the same `offlineDb.ts` primitives (`getPendingSales`, `incrementRetries`, the `status !== 'stuck'` filter, `rewritePendingSalesCustomerId`, etc.) that `POSScreen.tsx`'s page-context `syncPending`/`syncPendingCustomers` already use. Only the network-calling loop and auth handling are separate, since they need different failure behavior (no page redirect on refresh failure inside a service worker).

Auth for the SW path comes from a new IndexedDB mirror (`tokenStore.ts`, `db.ts`'s new `authTokens` table): `auth.ts`'s `setTokens`/`clearTokens` now also write/clear this mirror (fire-and-forget, best-effort — page-context auth is unaffected if it fails). The SW reads from this mirror and refreshes it directly against `/auth/refresh` if the token is dead, mirroring `ensureFreshToken`'s logic without the page-only bits.

### Sync status UI
Replaced the inline connectivity-dot/stuck-count bits with a `SyncStatusPanel`: pending count (existing), last-successful-sync time (new — `syncMeta` store, key `pendingSync`, written by both the page-context sync functions and `swSync.ts` so the UI reflects either path), and stuck-item count with a "Retry" action (new — resets stuck sales/customers back to `pending` via new `resetStuckSale`/`resetStuckCustomer` offlineDb.ts helpers, then triggers a sync if online).

### Bug found and fixed during verification
Bundling `swSync.ts` into `sw.ts` means the Vite build now emits `sw.js` containing a static ES `import` (it did not before — the old file was fully self-contained). That requires `navigator.serviceWorker.register('/sw.js', { type: 'module' })`; without it, registration would silently fail outright, taking down the *entire* service worker (catalog caching, offline navigation fallback from OFFLINE-03/04), not just background sync. Caught by manually running `vite build` and inspecting `dist/sw.js` — the phase's own build-verification steps (`tsc --noEmit` only) would not have caught it, since no `vite build` step is currently wired into this app's `pnpm build`/CI at all. Fixed by adding `{ type: 'module' }` to the registration call.

**Known trade-off from that fix:** module service workers are Chromium-only (Firefox has never shipped this — verify current status before relying on it). Since Background Sync itself is already Chromium/Android-only, this doesn't reduce Background-Sync-relevant coverage, but it does mean a browser without module-SW support gets **no service worker at all** (losing catalog caching / offline navigation fallback too), rather than falling back gracefully. This is a real, if narrow, regression risk for non-Chromium users of the pre-existing SW features and should be revisited if/when a real `vite build` pipeline is wired up for this app.

## Browser Support Verified
| Browser | Background Sync | Module Service Worker | Fallback tested |
|---|---|---|---|
| Chromium/Chrome/Edge (Android + desktop) | Yes | Yes | N/A — primary path |
| Firefox | No | No (long-standing gap — reverify before shipping) | Tab-open triggers only; SW itself won't register at all post this change |
| Safari/iOS | No | No | Tab-open triggers only; SW itself won't register at all post this change |

Not manually verified in a real browser this session (no live device matrix available) — verified via code inspection, unit tests against the sync core, and a manual `vite build` inspection of the emitted `dist/sw.js`. Recommend a manual pass in Chrome DevTools' Background Sync simulation (Application panel → Background Services → Background Sync) before this ships.

## Files Changed
| File | Change |
|---|---|
| `apps/pos-frontend/src/db.ts` | New `authTokens` Dexie table (version 4) |
| `apps/pos-frontend/src/tokenStore.ts` | New — IndexedDB token mirror for SW access |
| `apps/pos-frontend/src/auth.ts` | `setTokens`/`clearTokens` mirror to IndexedDB (best-effort) |
| `apps/pos-frontend/src/swSync.ts` | New — SW-safe sync core, reuses `offlineDb.ts` primitives |
| `apps/pos-frontend/src/sw.ts` | Real `sync` event handler, dead scaffold removed |
| `apps/pos-frontend/src/offlineDb.ts` | `resetStuckSale`/`resetStuckCustomer` for manual retry |
| `apps/pos-frontend/src/background-sync.d.ts` | New — ambient types for `SyncManager`/`ServiceWorkerRegistration.sync` (not in TS's shipped DOM lib) |
| `apps/pos-frontend/src/POSScreen.tsx` | Background sync registration, `SyncStatusPanel` UI, `retryStuckItems`, `{ type: 'module' }` fix |
| `apps/pos-frontend/src/__tests__/tokenStore.test.ts` | New |
| `apps/pos-frontend/src/__tests__/swSync.test.ts` | New |
| `apps/pos-frontend/src/__tests__/offlineDb.test.ts` | Updated table list + new reset-helper tests |

## Tests: 46/46 PASS | lint: pre-existing failures only (see below) | type-check: PASS | build (`tsc --noEmit`): PASS

Lint (`pnpm --filter @erp/pos-frontend lint`) already failed before this phase (176 problems, monorepo-wide missing-globals config gap — see prior audit notes) and still fails after (201 problems). All newly-added problems are the same two pre-existing categories (`no-undef` for browser/webworker globals the ESLint config doesn't declare; `no-non-null-assertion` warnings matching existing test-file conventions) — no new category of lint issue was introduced.

## Known Issues / Deferred
- Full admin/multi-terminal monitoring dashboard deferred per roadmap.
- No real browser/device verification of Background Sync firing after tab close (no live device matrix this session) — code-level and unit-test verified only.
- Module-service-worker browser-support trade-off noted above — revisit once a real `vite build` deployment pipeline exists for `pos-frontend`.
- Conflict-resolution UI is OFFLINE-07.
