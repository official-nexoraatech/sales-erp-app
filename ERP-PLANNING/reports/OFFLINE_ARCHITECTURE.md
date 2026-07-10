# Offline-First Architecture — `apps/pos-frontend` (as built)

**Date:** 2026-07-05
**Scope:** Describes what OFFLINE-01 through OFFLINE-09 actually built and shipped (all nine phases have landed — see `ERP-PLANNING/phase-completions/OFFLINE-0{1..9}_COMPLETION.md`). This is a description of the implementation, not the original aspirational 15-phase spec — see `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` for the roadmap that scoped this down, and `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` for the original audit.
**Author's note:** only `apps/pos-frontend` has any offline capability. `apps/web-frontend` remains fully online-only (out of scope for this program, per the roadmap's rescoping of OFFLINE-09).

---

## 1. Local database (OFFLINE-03)

`apps/pos-frontend/src/db.ts` defines a Dexie (IndexedDB wrapper) database, `pos-offline`, versioned incrementally so existing devices upgrade in place without data loss:

| Table | Key | Purpose | Added in |
|---|---|---|---|
| `pendingSales` | `++id` (autoincrement) | Queued sales awaiting sync | v1 (raw IndexedDB `pending_sales`) → v2 (Dexie rename) |
| `catalogItems` | `id`, indexed on `tenantId`, `barcode` | Delta-synced item/price/tax master for offline scan & sale | v2 |
| `customers` | `id`, indexed on `tenantId`, `phone`, `displayName` | Delta-synced customer cache for offline lookup | v2 |
| `priceListItems` | `id`, indexed on `tenantId`, `priceListId`, `itemId` | Delta-synced price-list overrides | v2 |
| `taxRates` | `hsnCode`, indexed on `tenantId` | Delta-synced GST/cess rates by HSN code | v2 |
| `heldSales` | `++id`, indexed on `tenantId`, `branchId` | Local-only park/resume; backend is only a best-effort audit copy | v2 |
| `syncMeta` | `store` | Per-store delta-sync cursor (`lastSyncedAt`, `cursor`) | v2 |
| `pendingCustomers` | `++id`, indexed on `localCustomerId` | Queued offline-created customers awaiting sync | v3 |
| `authTokens` | `id` (fixed `'current'` row) | Mirror of the page's localStorage tokens, readable by the service worker | v4 |

A device with pre-existing raw-IndexedDB `pending_sales` rows has them copied into `pendingSales` automatically by the v2 `.upgrade()` migration callback — no manual intervention or data loss on upgrade.

## 2. Sync protocol — delta download (OFFLINE-04)

Reference data (catalog items, customers, price-list items, tax rates) is pulled, never pushed, via `GET /sync/{customers,items,price-list-items,tax-rates}` (`apps/sales-service/src/api/sync.routes.ts` and equivalents). Each endpoint:

- Scopes strictly by `tenantId` and (unless the caller holds `BRANCH_SCOPE_BYPASS`) by `getBranchScope(auth)` — a cashier's device only ever receives data for branches they're assigned to.
- Accepts `modifiedSince` (ISO timestamp) to return only rows changed after that point, and `page`/`size` for pagination, responding with `{ content, totalElements, hasMore }`.
- Is paged by the client (`apps/pos-frontend/src/referenceSync.ts`'s `syncAllReferenceData`) in a loop until `hasMore` is false, upserting each page into the corresponding Dexie table.

The client tracks one `syncMeta` cursor per store. **The cursor only advances after a full successful pull** — a failure partway through a paginated pull leaves the prior cursor in place, so the next sync attempt resumes rather than silently skipping the failed range. A minimum re-sync interval and an in-flight-overlap guard prevent redundant concurrent syncs when both "on login" and "on reconnect" fire close together.

## 3. Sync protocol — queued writes & idempotency (OFFLINE-02, OFFLINE-05)

Sales and offline-created customers are queued locally (`pendingSales`/`pendingCustomers`) and pushed on reconnect. Each queued item is assigned a client-generated `operationId` (`crypto.randomUUID()`) **once, at queue time**, and that same `operationId` is carried through every retry of the same item — this is the mechanism that prevents duplicate invoices on retried sync (the single most severe finding from the original audit). The server (`pos.routes.ts`, `customer.routes.ts`) atomically dedupes on `operationId`, so a retried request against a lost acknowledgment produces exactly one invoice/customer, not two.

Sync attempts happen from two contexts sharing the same primitives:
- **Page-context**, in `POSScreen.tsx` — triggered by the `window online` event or the manual "Sync now" button.
- **Service-worker context**, in `swSync.ts`'s `runBackgroundSync()` — triggered by the Background Sync API (`sw.ts`'s `sync` event handler), which can fire even after the tab that queued the sale has closed.

Both call the same `offlineDb.ts` primitives (`queueSale`, `incrementRetries`, `markStockConflict`, `resolveConflict`, etc.), so the retry/dedupe/stuck-transition semantics are identical regardless of which context ran the sync — there is no separate, divergent "background" code path to keep in sync with the tab-open path.

Customers are always synced **before** sales in both contexts: a sale queued offline may reference a customer created offline (via a negative local placeholder id), and once that customer syncs and gets its real server id, `rewritePendingSalesCustomerId()` rewrites any still-queued sale referencing the old placeholder id — otherwise the sale's sync would submit a `customerId` that only ever existed locally and fail its foreign-key check server-side.

## 4. Auth & token refresh (OFFLINE-01, OFFLINE-06)

`auth.ts` wraps `fetch` (`authFetch`) so a 401 triggers a single, de-duped `POST /auth/refresh` call (a burst of queued-item syncs discovering a dead token at once shares one refresh, not one each) and retries the original request once with the new token. A dead refresh token forces a fresh login (`forceLogout`).

Because the service worker has no `localStorage`/`window` access, `tokenStore.ts` best-effort-mirrors the current access/refresh tokens into the `authTokens` Dexie table on every `setTokens()` call. `swSync.ts`'s `swFetch` reads from this mirror instead. A failed mirror only means a background sync attempt waits for the next tab-open sync — it never breaks page-context auth, which keeps `localStorage` as its source of truth throughout.

## 5. Background Sync & fallback (OFFLINE-06)

`supportsBackgroundSync()` feature-detects `'serviceWorker' in navigator && 'SyncManager' in window` (true on Chromium/Android; false on Safari/iOS/Firefox). Where supported, `registerBackgroundSync()` registers the `sync-pending-sales` tag (safe to call repeatedly — re-registering is a no-op). Where unsupported, there is no separate fallback implementation to maintain: the existing tab-open triggers (`window online` listener, manual "Sync now") call the identical sync primitives, so sync still works correctly — it simply requires the tab to be open, same as before Background Sync was added.

## 6. Conflict resolution (OFFLINE-07)

A sale can fail sync because stock changed between when it was queued and when it synced. The server distinguishes this (`INSUFFICIENT_STOCK` error code with `{ itemId, available, requested }` details) from a generic/transient failure. The client routes it to `markStockConflict()` instead of the normal retry-counter path — a stock conflict is a deterministic business failure that would just fail identically on blind retry, so it jumps straight to `status: 'stuck'` with the conflict detail attached, and is excluded from the generic "N items need attention — Retry" stuck-item bucket.

The `StockConflictModal` (in `POSScreen.tsx`) shows the queued vs. currently-available quantity per conflicting item and offers:
- **Adjust & retry** — clamps the line's quantity down to what's available, drops any line that becomes zero, and re-queues under a **new** `operationId` (the original operationId's server-side draft invoice was already voided — reusing it would just hit the dedupe path against that dead record).
- **Cancel** — removes the item from the queue outright.

## 7. Read-only offline lookup (OFFLINE-09)

`LookupScreen.tsx` is a read-only item/price/tax and customer counter-lookup screen, backed entirely by the same `catalogItems`/`customers` Dexie tables OFFLINE-04 already syncs — no new sync endpoint or storage was added for it. It shows the same `ConnectivityDot`/`formatLastSync` staleness indicator convention as `POSScreen.tsx` (`ConnectivityStatus.tsx`), scoped per-tab since items and customers sync on independent cursors.

## 8. PWA shell (OFFLINE-08)

`apps/pos-frontend/public/manifest.json` plus icon assets make the app installable on Chromium/Android (standalone window, custom icon/name) and to a lesser degree via iOS Safari's Add to Home Screen. This only affects how the app is launched — it does not change any of the sync/offline mechanisms above.

---

## Troubleshooting

**A sale is stuck with "N items need attention — Retry."**
This is a sale that failed to sync `MAX_RETRIES` (5) times in a row for a reason other than a stock conflict — almost always a persistent network/server error. Clicking "Retry" resets it to `pending` and immediately re-attempts a sync if online. If it keeps getting stuck, check the sales-service logs for the actual rejection reason (it is not a stock conflict, or it would show under the conflict banner instead).

**A sale is stuck under "N stock conflict(s) — Resolve."**
Stock changed since the sale was queued offline. Open the resolver (`StockConflictModal`): it shows queued vs. currently-available quantity per item. Adjusting re-queues the sale for the available quantity under a fresh operationId; cancelling drops it. Either action results in exactly one final invoice, never zero or two.

**Sync silently stops working after a long outage.**
Almost always a token refresh failure — the refresh token itself has expired or was revoked server-side. Page-context sync forces a fresh login in this case (`forceLogout()` in `auth.ts`); background (service-worker) sync just leaves items queued until the user reopens the tab and logs in again, since a service worker cannot force a navigation.

**Background Sync doesn't seem to be firing.**
Confirm the browser supports it (`'serviceWorker' in navigator && 'SyncManager' in window` — false on Safari/iOS and Firefox by design). Where unsupported, sync only happens while a tab is open (`window online` / manual "Sync now") — this is expected, not a bug.

**A device has an old raw-IndexedDB `pending_sales` store from before OFFLINE-03.**
It's migrated automatically into `pendingSales` the first time the app opens the v2+ database — no manual step needed.

---

## Known gaps / deferred (not fixed by OFFLINE-10)

- `apps/web-frontend` remains fully online-only; this program never touched it beyond the OFFLINE-09 rescoping decision.
- The repo-wide `pnpm test:coverage` (`turbo run test:coverage`) convention is broken independent of this program: `@vitest/coverage-v8` is only a declared dependency of `packages/platform-sdk`, so pnpm's per-package `node_modules` isolation makes it unresolvable from every other package that defines a `test:coverage` script (verified locally against `apps/sales-service` — pre-existing, not introduced by OFFLINE-10). CI's "Test (Coverage ≥ 80%)" job may already be silently affected by this for those packages. `apps/pos-frontend` and `apps/web-frontend` deliberately do **not** define a `test:coverage` script for this reason; see `ERP-PLANNING/phase-completions/OFFLINE-10_COMPLETION.md` for how their tests are wired into CI instead.
- `docs/training/CASHIER_GUIDE.md` mismatches unrelated to this program (discount button, split payment, UPI display) remain open — only its offline-related sections were reconciled here.
