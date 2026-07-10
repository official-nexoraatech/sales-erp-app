# Offline Readiness Report

**Date:** 2026-07-05
**Question driving this report:** Can this ERP be deployed to a retail customer who may have unstable or no internet connectivity for hours at a time, without risking data loss?
**Scope reviewed:** `apps/web-frontend` (main back-office SPA), `apps/pos-frontend` (dedicated POS screen), backend write paths in `apps/sales-service`, shared schema in `packages/db-client`, and the whole repo for desktop-packaging frameworks.
**Method:** direct code reading (file:line citations below), not documentation or claims. Every conclusion in this report was verified against the current codebase on 2026-07-05.

---

## 1. Does the ERP support working as a desktop application (Windows/macOS/Linux)?

**No. It is a web application only.**

- Exhaustive search of all 25 `package.json` files in the repo (root + every `apps/*` + every `packages/*`) for `electron`, `tauri`, `@tauri-apps`, `nwjs`, `@capacitor` — **zero matches**.
- No `electron-builder.yml`, `tauri.conf.json`, `forge.config.js`, or any comparable packaging config anywhere in the repo.
- No `BrowserWindow`, `ipcMain`, or `app.whenReady` anywhere in the codebase — i.e., no Electron main-process code exists to even be misconfigured.
- The word "desktop" appears in `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md` (lines 59, 773, 1609, 1819–1843), e.g. line 1825: *"The ERP is a desktop-first application. All designs start at 1280px."* — this is a CSS breakpoint convention for a wide browser viewport, **not** a native application. It should not be mistaken for desktop packaging when read out of context.
- Not even a **PWA** exists as a lightweight substitute: neither `apps/web-frontend` nor `apps/pos-frontend` has a `manifest.json`/`manifest.webmanifest`, so neither app is "installable" via a browser's Add-to-Home-Screen/Add-to-Desktop mechanism. `apps/pos-frontend` has a service worker (see §2) but no manifest to pair with it, so it cannot be installed as a standalone window either — it only runs inside a browser tab.

**Conclusion:** every user — back office or store counter — must run this in a browser, with a live browser process, no matter how good the offline logic underneath is.

---

## 2. Does it support offline mode? Which modules work offline, which don't?

**Split personality: one of the three frontends has real (partial) offline support; the other two have none.**

| App | Offline support |
|---|---|
| `apps/web-frontend` (invoices, inventory, HR, accounting, CRM, purchases, GST, reports — the bulk of the ERP) | **None.** Verified absence of service worker, IndexedDB, PWA manifest, and offline-related packages. |
| `apps/pos-frontend` (dedicated counter-sale screen) | **Partial.** IndexedDB queue for sales + a hand-rolled service worker, but a narrow feature slice. |
| Not audited here (in scope of a separate report) | `sale-erp-froentend`/`sale-erp-backend` — abandoned prototype, not part of the pnpm workspace, irrelevant to production offline readiness. |

### 2a. `apps/web-frontend` — confirmed zero offline capability

- No service worker: no `sw.ts`/`sw.js`, no `serviceWorker.register`/`navigator.serviceWorker` anywhere in `apps/web-frontend/src`, and `apps/web-frontend/vite.config.ts:1-10` registers only `react()` and `tailwindcss()` — no `vite-plugin-pwa` or Workbox.
- No IndexedDB: zero references to `indexedDB`, `idb`, or `Dexie` under `apps/web-frontend/src`.
- No offline write-queue: the only `localStorage`/`sessionStorage` usage is `src/store/auth.store.ts:41` (zustand `persist` for the auth token/user object) and `src/store/recentSearches.store.ts:20-33` (command-palette recent-search history, explicitly a UI convenience) — neither queues API writes.
- No `navigator.onLine` check exists anywhere in the codebase.
- Network-failure handling is fail-fast: `src/api/client.ts` uses plain `fetch`, React Query is configured `mutations: { retry: 0 }` and `queries: { retry: 1 }` (`src/main.tsx:25-26` — a same-request HTTP retry, not an offline queue). A failed write simply throws and surfaces as a `toast.error(...)` (e.g. `src/pages/gst/EInvoicePage.tsx:92`). Nothing is queued, nothing is replayed.
- No `public/` directory in `apps/web-frontend` at all — confirming no PWA manifest, no offline assets.

**Implication:** invoicing, inventory adjustments, purchase orders, accounting journal entries, HR, CRM, GST filings, reports — everything done in the main back-office app — **stops working the instant the connection drops**, with no queuing and no recovery path other than the user manually retrying the action once the network is back.

### 2b. `apps/pos-frontend` — the only offline-capable surface, and it's narrow

**What is stored offline:** a single IndexedDB database `pos-offline` (v1), with one object store, `pending_sales` (`apps/pos-frontend/src/offlineDb.ts:1-19`), holding queued sale-creation payloads: `{ id, payload, createdAt, retries }` (`offlineDb.ts:5-10`). `payload` is the raw request body for a completed sale — cart lines, customer id, payment mode, tendered amount, loyalty redemption, split payments (built by `salePayload()` in `POSScreen.tsx:435-453`). **Nothing else is stored offline** — no cached product catalog beyond a small "quick items" grid, no customer list, no held-sale data.

**What the service worker caches** (`apps/pos-frontend/src/sw.ts`, hand-rolled, no Workbox):
- App shell only at install (`/`, `/index.html` → cache `pos-v1`, `sw.ts:4-17`).
- Network-first-with-cache-fallback for exactly two API paths: `GET /api/v2/pos/quick-items` and `GET /api/v2/pos/customer-search` (`sw.ts:8-11, 31-41`) — cached into `pos-catalog-v1`.
- Navigation fallback to cached `index.html` if a page navigation fails offline (`sw.ts:44-50`).
- Every other request — including the sale-submission POST itself, held-sale fetches, receipt sending, UPI endpoints — is **not intercepted at all**; it just fails naturally when offline.

**What actually works with no internet, in `apps/pos-frontend`:**
- ✅ Loading the quick-items grid and customer search results (served from SW cache if previously fetched while online).
- ✅ Scanning/adding items to a cart, selecting a cached customer, completing a sale — the sale is queued to IndexedDB instead of posted (`POSScreen.tsx:456-472`).

**What does NOT work offline, even inside the "offline-capable" POS app:**
- ❌ Held sales / park-and-resume (`POSScreen.tsx:507-551`) — online-only fetches, no offline path.
- ❌ Customer search/creation for a customer not already in the cached quick-list/search cache (`POSScreen.tsx:301-319, 553-578`).
- ❌ Returns/Exchange — not implemented in this app at all; it's an outbound link to the main `web-frontend` app (`POSScreen.tsx:617-619`), which per §2a has no offline support whatsoever.
- ❌ Receipt sending (email/WhatsApp) — online-only, not queued.
- ❌ Any inventory lookup beyond the small quick-items list, any reporting, any customer management screen — `apps/pos-frontend` has exactly two routes total (`main.tsx:20-33`): `/login` and a catch-all to `POSScreen.tsx`. There is no separate inventory/customer/report page in this app to even attempt offline.

**Answer to "which modules work offline":**
- **Fully offline-capable:** none, strictly speaking — even cart-building depends on previously-cached quick items/customers.
- **Partially offline-capable:** POS quick-sale checkout only (cart from cached quick-items + cached/previously-seen customers, sale queued locally).
- **Completely online-only:** the entire main ERP (`web-frontend`) — invoicing, inventory, HR, accounting, purchases, GST, CRM, reports — plus, within the POS app itself: held sales, customer search/creation beyond cache, returns, receipt delivery.

---

## 3. Can users continue working without internet across Sales, POS, Inventory, Billing, Customer Management?

Answered per module, verified against the code:

| Module | Works offline? | Evidence |
|---|---|---|
| POS quick-sale checkout | Partially | `offlineDb.ts` queue + `POSScreen.tsx:456-472` |
| POS held sales | No | `POSScreen.tsx:507-551`, online fetch only |
| POS returns | No | Delegated to `web-frontend` (`POSScreen.tsx:617-619`), which is online-only |
| Full invoice creation (web-frontend) | No | No offline code in `apps/web-frontend` at all (§2a) |
| Inventory management | No | Same — `web-frontend`-only feature, no offline path |
| Customer management (create/edit) | No | `web-frontend` CRM pages have no offline path; POS-side customer creation is online-only too |
| Billing/invoice PDF, payments, accounting | No | `web-frontend`-only, online-only |

**Bottom line:** only the narrowest slice of one of three frontends — ringing up a sale at a POS counter using already-cached quick items and a cached/known customer — continues to function without internet. Everything else in the ERP requires a live connection.

---

## 4. Is data stored locally while offline? Where and how?

**Yes, but only for one data type, in one app.**

- `apps/pos-frontend` uses the **raw browser IndexedDB API directly** — no `idb` or `Dexie` wrapper library is even a dependency (confirmed absent from `package.json`). Database `pos-offline`, one object store `pending_sales`, keyed by autoincrement `id` (`offlineDb.ts:1-19`).
- Four CRUD helpers exist: `queueSale` (add), `getPendingSales` (getAll), `deletePendingSale` (delete), `incrementRetries` (get+put) — but `incrementRetries` is **dead code**, never called anywhere in `POSScreen.tsx` despite being fully implemented (`offlineDb.ts:57-72`). The `retries` field is written as `0` at insert time and never updated, so there is no actual retry-count tracking despite the schema supporting it.
- **Durability:** IndexedDB persists across page reloads and browser restarts by design, and the code confirms the queue is rehydrated correctly on load (`refreshPendingCount()`, `POSScreen.tsx:229-232, 257-258`). One caveat: the *in-progress, not-yet-completed* cart (items added but "Complete Sale" not yet clicked) lives in plain React `useState` (`POSScreen.tsx:189-207`) with zero persistence — refreshing mid-cart-build loses that cart, though this is before queuing, not a loss of already-completed sales.
- **No local relational database (SQLite, etc.) exists anywhere.** IndexedDB is the only local persistence mechanism in the entire application, and it holds exactly one record type: pending sale payloads. No cached inventory master data, no cached customer master, no cached pricing beyond what the SW opportunistically cached for the quick-items/customer-search endpoints.
- `apps/web-frontend` stores **nothing** offline beyond an auth token (§2a) — no business data survives a connection drop there at all; an in-flight, unsaved form is simply lost.

---

## 5. When internet is restored, does it automatically synchronize offline data?

**Partially — POS sales only, with weak triggers and no batch protocol.**

- **Trigger mechanism:** a plain `window.addEventListener('online', handleOnline)` in `POSScreen.tsx:275`, which calls `syncPending()` (`POSScreen.tsx:270-273`). There is also a manual "Sync now" button (`POSScreen.tsx:621-628`).
- **No Background Sync API** (`SyncManager`/`sync.register`) is used anywhere — grepped, zero matches. This matters because the manual/online-event approach only fires while the tab is open and focused; the Background Sync API exists specifically so a service worker can sync even if the tab is closed, and this codebase doesn't use it despite already having a service worker in place.
- **The sync itself is not a batch/protocol call** — `syncPending()` (`POSScreen.tsx:234-255`) loops over `getPendingSales()` and issues **one individual `POST /pos/sales` request per queued item**, sequentially. On success it deletes the local record; on failure it silently leaves the item queued with no backoff or retry-count increment (confirmed dead `incrementRetries`, §4).
- **No dedicated sync endpoint exists on the backend at all.** A broad search across every `apps/*/src/api` route file for sync/offline-queue/batch patterns found nothing relevant — the only "sync" hits in the repo are the internal search-index sync routes (unrelated) and import/export scheduler routes. The POS app just replays the normal single-sale-creation endpoint.
- **Dead/unreachable wiring:** the service worker listens for a `SYNC_PENDING` message and, on receipt, broadcasts `DO_SYNC` back to the page, which would call `syncPending()` (`sw.ts:53-65`, `POSScreen.tsx:263-267`) — but nothing in the codebase ever registers a `sync` event in the service worker or posts a `SYNC_PENDING` message to it. This code path is unreachable in the current build; it looks like an intended Background Sync integration that was never finished.

**Answer:** yes, in a limited sense — if the POS tab is open and online is detected (or the user clicks "Sync now"), queued sales are replayed one at a time against the live API. This does not happen in the background if the tab is closed, does not happen for any other module (inventory, invoices, customers, held sales), and has no true batch-sync protocol.

---

## 6. How are conflicts handled if the same record is modified locally and on the server?

**They are not handled at all — this is the most serious gap in the system.**

- **No idempotency key is ever generated or sent.** `apps/pos-frontend/src/offlineDb.ts:5-10` stores only `{ payload, createdAt, retries }` — no client-generated UUID is attached to a queued sale before it's queued or before it's replayed (`POSScreen.tsx:456-472`). Grepping the whole backend for `idempotency`/`Idempotency-Key`/`clientId`/`requestId` on the sales-creation path returns nothing; the only idempotency support in the entire repo is scoped to `notification-service` (`packages/db-client/src/schema/notification.ts:69-81`, unrelated to sales).
- **The backend cannot deduplicate a retried sync.** `POST /pos/sales` (`apps/sales-service/src/api/pos.routes.ts:145-267`) generates its own invoice number server-side as `` `POS-${tenantId}-${Date.now()}` `` (`pos.routes.ts:170`) — a fresh number every call. The only relevant uniqueness constraint is `unique('invoices_tenant_number').on(tenantId, invoiceNumber)` (`packages/db-client/src/schema/sales.ts:142`), which does nothing to catch a duplicate submission of the *same* queued sale, because each retry gets a new, unique invoice number and passes the constraint. **Concretely: if a sync POST succeeds on the server but the success response is lost before the client reads it (a very normal failure mode on flaky connections — exactly the scenario this ERP is meant to be resilient to), the client leaves the item in the queue and resubmits it on the next sync, creating a second real invoice, a second stock deduction, a second payment record, and duplicated loyalty-points accrual.** Nothing anywhere in the stack prevents this.
- **Stock conflicts are detected, but only handled as a hard failure, not a merge.** The good news: stock deduction is atomic and safe — `UPDATE items SET availableQty = availableQty - qty, version = version + 1 WHERE ... AND availableQty >= qty` inside a transaction (`apps/sales-service/src/domain/InvoiceService.ts:374-387`) — so a queued sale that syncs after stock has changed correctly fails closed (`InsufficientStockError`, `InvoiceService.ts:389-398`) rather than allowing overselling. But "correctly fails" here means **the sale is rejected outright** — there is no conflict-resolution UI, no partial-fulfillment option, no "stock changed, here's what's available now, adjust and retry" flow. The cashier's queued sale for e.g. 5 units silently stays stuck in the pending queue (or the toast reports a generic sync failure) with no guidance.
- **`items.version` is correctly used as an optimistic lock for stock; `invoices.version` is tracked but not enforced.** The `invoices` table also has a `version` column (`sales.ts:139`), but no update path was found that checks it in a `WHERE version = $expected` clause — so it exists in the schema without functioning as a concurrency guard for invoice-level edits.

**Answer:** there is no conflict-resolution strategy of any kind — no last-write-wins, no merge, no user-facing conflict prompt, and critically, **no duplicate-prevention for retried offline syncs**, which is a data-integrity risk (double invoices, double stock deduction, double payment) rather than a mere UX gap.

---

## 7. Feature readiness classification

| Feature | Classification | Basis |
|---|---|---|
| POS quick-sale checkout (cached items + cached customer) | 🟡 Partially offline-ready | Queues to IndexedDB, syncs on reconnect, but no idempotency/dedup protection |
| POS held sales | 🔴 Online-only | No offline code path |
| POS customer search/creation (uncached) | 🔴 Online-only | Falls through to live fetch |
| POS returns/exchange | 🔴 Online-only | Delegated entirely to `web-frontend` |
| POS receipt delivery | 🔴 Online-only | Not queued |
| All of `web-frontend` (invoicing, inventory, billing, HR, accounting, CRM, GST, reports, customer management) | 🔴 Online-only | Zero offline infrastructure found anywhere in the app |
| Desktop app / installable app | 🔴 Does not exist | No Electron/Tauri, no PWA manifest in either frontend |
| Automatic background sync (tab closed) | 🔴 Does not exist | No Background Sync API registration; sync only runs while `POSScreen.tsx` is mounted and an `online` event fires or the user clicks "Sync now" |
| Conflict detection/resolution | 🔴 Does not exist | No idempotency keys, no invoice-level optimistic locking enforcement, no merge UI |
| Stock-safety under concurrent writes | 🟢 Solid | Atomic conditional `UPDATE ... WHERE availableQty >= qty` with `version` bump |

No feature in this system qualifies as **fully offline-ready** by the standard of "works the same, indefinitely, regardless of connectivity, with guaranteed-safe sync" — even the best-covered feature (POS checkout) depends on previously-cached reference data and has a real duplicate-invoice risk on sync.

---

## 8. Is the current architecture production-ready for offline-first retail usage?

**No.**

Reasoning, weighing all evidence above:
1. Two of the three user-facing apps (`web-frontend`, and most of `pos-frontend`'s own features) have **zero** offline capability — a connectivity drop mid-task simply loses unsaved work with a toast error.
2. The one offline-capable path (POS checkout) has a **concrete, demonstrable data-integrity bug**: any sync request whose success response is lost in transit creates a duplicate invoice, a duplicate stock deduction, and a duplicate payment/loyalty entry, because there is no idempotency key anywhere in the flow. This is precisely the failure mode "unstable internet" produces routinely — request succeeds, ack doesn't come back — so this isn't a theoretical edge case for this use case, it's a primary one.
3. There's no automatic background sync (no Background Sync API usage despite a service worker already existing) — sync only happens if the POS tab stays open and either fires an `online` event or the cashier remembers to click "Sync now."
4. No conflict-resolution UX exists at all — a rejected sync (e.g., stock ran out) leaves a queued sale stuck with a generic error, no guided remediation.
5. Held sales, returns, customer management, and receipt delivery — all realistic day-to-day counter operations — have no offline path even inside the one app that was built with offline in mind.
6. No local structured database or cached master data (catalog, pricing, customers) exists beyond a small opportunistically-cached quick-items/customer-search response — so a longer outage (hours, per the stated requirement) will exhaust the cache's usefulness quickly for anything beyond the pre-cached quick-items list.
7. Untested: no unit/integration tests exist for the IndexedDB queue or sync logic at all (`apps/pos-frontend` has no `__tests__` directory and no test runner configured) — the one offline code path in the whole system has never been automatically verified.

---

## 9. Gap list vs. enterprise offline-first ERP/POS standards (Shopify POS, Square POS, Dynamics 365, SAP B1, Odoo)

Each of the named systems for retail-with-flaky-connectivity typically provides: (a) a real local database mirroring server schema, (b) full CRUD offline for core retail operations, not just checkout, (c) idempotent/deduplicated sync with a client-generated operation ID, (d) explicit conflict resolution policy (often field-level merge or last-writer-wins with audit trail), (e) background sync independent of an open tab, (f) installable app shell (PWA or native), and (g) monitoring/alerting for stuck sync queues.

| Gap | Current state | Estimated effort |
|---|---|---|
| **Idempotency keys on offline-queued writes** (client-generated UUID sent with every queued POS sale; backend dedupes on it) | Absent entirely — biggest and most urgent single fix | **Small–Medium.** Add a client-generated UUID to `PendingSale`/`salePayload()`, add a unique column on the accepting table, check-and-skip on duplicate in `pos.routes.ts`. |
| **Automatic background sync (tab-independent)** | Manual `online` event + button only; SW `DO_SYNC` wiring exists but is unreachable dead code | **Medium.** Wire up actual `sync` event registration (`self.addEventListener('sync', ...)`) in `sw.ts` and call `registration.sync.register(...)` from the page; requires HTTPS + browser support handling (no Background Sync on iOS Safari — needs a documented fallback). |
| **Offline support for held sales, customer search/create, returns, receipts** | None | **Medium–Large per feature.** Each needs its own IndexedDB store, its own queue/sync logic, and conflict handling; returns in particular touches stock reversal, which needs the same idempotency treatment as sale creation. |
| **Any offline capability in `web-frontend`** (invoicing, inventory, accounting, HR, CRM, GST) | None — this is most of the ERP's functionality | **Large.** This is a from-scratch offline architecture effort for the majority of the product surface, not an incremental fix; realistically it means picking a sync framework (e.g. a local-first library, or replicated Postgres via something like ElectricSQL/PowerSync) rather than hand-rolling per-page IndexedDB queues. |
| **Conflict resolution policy + UI** | None — failures surface as a generic error, queued items get stuck silently | **Medium.** Needs an explicit product decision (reject-and-notify vs. partial-fulfillment vs. manager-review queue) before it can be built; the backend groundwork (atomic stock check) is already there. |
| **Local cached master data** (catalog, pricing, customer directory) beyond the small quick-items cache | Only two endpoints cached, opportunistically, not a deliberate full-catalog offline mirror | **Medium.** Needs a deliberate "sync catalog to IndexedDB on login / periodically" strategy with a real limit/pagination plan for large catalogs. |
| **Installable app shell** (PWA manifest, icons, or an Electron/Tauri wrapper) | Neither exists in either frontend | **Small (PWA manifest)** to **Medium (Electron/Tauri wrapper with auto-update)**, depending on which the client actually needs — a manifest alone won't provide OS-level resilience (auto-restart, background sync while fully closed) the way a native wrapper could. |
| **`invoices.version` enforced as an optimistic lock** | Column exists, not checked in update paths | **Small.** Add a `WHERE version = $expected` guard where invoices are mutated concurrently. |
| **Automated tests for offline queue/sync** | None | **Small–Medium.** Straightforward once idempotency/backoff logic above is added — write it test-first. |
| **Retry backoff / max-retry / stuck-item alerting** | `retries` field exists in schema but is dead code, never incremented, no cap, no operator visibility into stuck queue items | **Small.** Wire up the existing `incrementRetries` function, add a max-retry threshold with a "needs manual review" state, surface stuck items to the cashier/admin UI. |

---

## 10. Can this ERP be confidently deployed to a customer who may lose internet for several hours?

**No — not without addressing at least the idempotency gap first, and ideally the broader gaps above.**

**Why not, concretely:**
- If the customer is a retail store using only `apps/pos-frontend` for counter sales during an outage of several hours, quick-sale checkout will keep working for cached quick-items and previously-seen customers, and sales will queue safely in IndexedDB (this part is genuinely solid and durable). **But when connectivity returns and the queue syncs, any request whose acknowledgment was lost — a realistic, common failure mode over unstable connections, not a rare edge case — will silently create a duplicate invoice with duplicate stock deduction and duplicate payment/loyalty records.** For a several-hours outage, there could plausibly be dozens of queued sales syncing back in a burst, and there is no way today to know after the fact which ones (if any) double-posted, because there's no dedup mechanism to have prevented it or audit trail designed to catch it after the fact.
- If any staff need to do anything beyond ringing up a quick sale during that outage — checking real inventory, managing a customer record, processing a return, viewing/creating any invoice/report in the main back-office app — **none of that works at all**; the app simply throws errors, and any unsaved form work is lost with no recovery.
- There is no desktop app and no installable PWA, so the "runs even if the browser/OS restarts mid-outage" resilience that a native or installed app would give doesn't exist — a browser tab has to stay open and no browser crash/restart can happen for the manual reconnect-and-sync trigger to fire.

**What would change this to a "yes":** closing the idempotency/dedup gap (§9, first row) is the single highest-leverage fix — it's the difference between "safe to let sales queue for hours" and "queuing for hours risks silent double-billing." After that, the honest scope of "yes, this can be deployed" should be explicitly limited to POS quick-sale checkout only, with the rest of the ERP's modules clearly communicated to the client as requiring connectivity — until the larger `web-frontend` and feature-completeness gaps in §9 are addressed.

---

## Production readiness score: **2/10**

**Rationale:** the score reflects that one narrow, real capability exists (durable local queuing of POS sales, and provably atomic/safe stock deduction on the backend) but is undermined by a concrete correctness bug (no sync idempotency → real risk of duplicate invoices/stock/payments, the exact scenario a multi-hour outage will trigger), is untested, and covers only a small fraction of the product's total functionality. The other two frontends and the bulk of the ERP's modules have literally zero offline infrastructure. This is meaningfully below what "offline-first" branding requires, and well below the reference systems named in this report (Shopify POS, Square, Dynamics 365, SAP B1, Odoo), all of which provide full local data mirrors, idempotent sync, and conflict resolution as baseline features.

---

## Final verdict

**This ERP cannot currently be deployed with confidence to a customer expecting to operate through multi-hour internet outages without risk of data loss or duplication.**

The one offline-capable feature (POS quick-sale checkout) will keep the cash register usable for cached items and known customers, but syncing the resulting queue back to the server carries a real, unmitigated risk of duplicate invoices, double stock deduction, and double payment/loyalty recording — precisely because there is no idempotency mechanism anywhere in the write path, and this is the most common failure mode unstable connections actually produce (ack lost, not request lost). Every other module — the entire back-office app, held sales, returns, customer management, receipts — has no offline behavior at all and will simply stop functioning, with unsaved work lost, the moment connectivity drops. Closing the idempotency gap is the minimum bar before this can be positioned as safe for flaky-connectivity deployment even for POS-only usage; broader offline-first parity with the reference products named in this report would require substantially more work across the rest of the application, as scoped in §9.
