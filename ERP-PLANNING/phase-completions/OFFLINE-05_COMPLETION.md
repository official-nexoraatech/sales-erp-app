# OFFLINE-05 Completion Report — POS Offline Feature Breadth
**Date:** 2026-07-05
**Status:** COMPLETE (backend + client logic; live-DB verification of the new migration deferred — see below)

## Scope Decision Confirmed Before Building
The phase doc flagged an open design question: whether held sales need to be visible
across multiple POS terminals at the same store. Confirmed with the user before starting:
**single-terminal, local-only.** Held sales are parked/resumed entirely from local Dexie
storage on the device that parked them; a best-effort backend copy is posted for
audit/backup only and never gates or blocks the local park/resume flow.

## Features Closed
| Feature | Offline behavior before | Offline behavior after |
|---|---|---|
| Held sales | Online-only fetch to `/pos/held-sales`; broken with no connection | Local Dexie `heldSales` table is the source of truth for park/resume/discard; works fully offline. Online, a best-effort (fire-and-forget) audit copy is also posted to the existing backend endpoint. |
| Customer search | Online-only fetch to `/pos/customer-search`; broken beyond the tiny cached quick-list | Always searches the local Dexie `customers` table (populated by OFFLINE-04's sync); supplemented by a live fetch merged in when online, to catch anything not yet synced locally. |
| Customer creation | Online-only `POST /customers`; failed outright offline | Offline, queues locally under a negative placeholder id (mirrors OFFLINE-02's client-generated-`operationId` sale pattern) and syncs idempotently on reconnect; a duplicate sync attempt is deduped server-side and returns the original record instead of creating a second customer. |
| Receipt | None — `POSScreen.tsx` already had a `window.print()`-based `ReceiptOverlay` (built ahead of this phase), but it only fired for the online-success path | Now also fires for offline (queued) sales, using the same in-memory cart/customer/payment data — works with zero network dependency. Shows a "saved offline — will sync" notice and hides WhatsApp/Email send buttons until the sale actually has a server invoice id. |

## Key Design Point: Cross-Queue Dependency
A customer created offline and then immediately used on a sale (also queued offline)
creates a real ordering hazard: the sale's queued payload embeds the customer's negative
placeholder id, which the server has never seen. Fixed by:
1. Syncing customers **before** sales on every reconnect trigger (`online` event, SW
   `DO_SYNC` message, and the "Sync now" button) — see `syncPendingCustomers().then(() =>
   syncPending())` in `POSScreen.tsx`.
2. `rewritePendingSalesCustomerId()` (`offlineDb.ts`) — as soon as a queued customer syncs
   and gets its real server id, every other still-queued sale that referenced the old
   negative id is patched to the real one before that sale is ever submitted.

Held sales referencing a not-yet-synced customer are not patched the same way (they're
local-only and non-financial); if the customer later syncs and the negative placeholder
row is replaced, a very old held sale's customer link degrades gracefully to "no customer
selected" on resume rather than failing. Documented as a known limitation below, not a
data-integrity risk (unlike the sale/customerId case, which is fixed above).

## Backend Changes
- **`packages/db-client/src/schema/master.ts`**: added `customers.clientOperationId`
  (`varchar(100)`, nullable) + unique index `customers_tenant_client_operation_id` on
  `(tenantId, clientOperationId)` — NULL never collides, so every non-offline
  customer-creation path is unaffected. Same convention as
  `invoices.clientOperationId` (OFFLINE-02).
- **`packages/db-client/migrations/0032_offline05_customer_idempotency.sql`** (+ journal
  entry) — additive `ALTER TABLE` / `CREATE UNIQUE INDEX ... IF NOT EXISTS`.
- **`apps/sales-service/src/api/customer.routes.ts`**: `CustomerSchema` accepts an
  optional `operationId`; `POST /customers` wraps the insert in try/catch, and on a
  unique-violation on the new constraint, returns the already-committed original customer
  with `200` instead of erroring — mirrors `pos.routes.ts`'s `DuplicateOperationError`
  handling for sales exactly, but inline (no separate service class exists for customers
  the way `InvoiceService` exists for invoices, so a small local `isUniqueViolation`
  helper was duplicated rather than exporting/coupling to `InvoiceService`'s copy).

## Frontend Changes
- **`apps/pos-frontend/src/db.ts`**: Dexie version bumped to 3, adding `pendingCustomers`
  table (`PendingCustomer` interface: `payload`, `operationId`, `localCustomerId`,
  `retries`, `status`). `HeldSale`'s comment updated to reflect it's now the actual
  source of truth, not schema-only.
- **`apps/pos-frontend/src/offlineDb.ts`**: added `queueCustomer` / `getPendingCustomers`
  / `deletePendingCustomer` / `incrementCustomerRetries` (same shape as the existing sale
  queue helpers) and `rewritePendingSalesCustomerId`.
- **`apps/pos-frontend/src/localStore.ts`**: added `deleteCustomerById` (removes the
  negative placeholder once the real synced record lands).
- **`apps/pos-frontend/src/auth.ts`**: added `getAuthClaims()` — decodes `tenantId`/
  `branchIds` already present in the existing JWT (no new endpoint or auth state) for
  Dexie records that need a tenant/branch scope written locally.
- **`apps/pos-frontend/src/POSScreen.tsx`**:
  - Held sales: `heldSalesData` query, `holdSaleMutation`, `resumeHeldSale`,
    `discardHeldSale` all rewritten against local Dexie (`upsertHeldSale` /
    `getHeldSaleById` / `getAllHeldSales` / `deleteHeldSale`); resume now also restores the
    associated customer from the local cache (the old online-only version silently
    dropped the customer on resume — fixed as a natural part of rewriting this code path,
    not a separate unrelated fix).
  - Customer search: split into a local Dexie query (always enabled) and a live query
    (enabled only when online), merged by id.
  - Customer creation: `createCustomerMutation` branches on `isOnline`; offline path
    writes a negative-id placeholder into the local `customers` table and queues it.
  - `syncPendingCustomers()` added, parallel to the existing `syncPending()`; wired into
    the `online` listener, the SW `DO_SYNC` message handler, and the "Sync now" button, in
    that order (customers first).
  - `refreshPendingCount()` now folds in the customer queue so the existing
    "N pending sync" / "N sale(s) need attention" indicators reflect both queues.
  - `CompletedSale` gained a `synced: boolean` field; `ReceiptOverlay` shows a
    "saved offline" notice and hides WhatsApp/Email buttons when `!synced`.

## Files Changed
| File | Change |
|---|---|
| `packages/db-client/src/schema/master.ts` | `customers.clientOperationId` + unique index |
| `packages/db-client/migrations/0032_offline05_customer_idempotency.sql` | New migration |
| `packages/db-client/migrations/meta/_journal.json` | Journal entry for migration 0032 |
| `apps/sales-service/src/api/customer.routes.ts` | Idempotent `POST /customers` |
| `apps/sales-service/src/__tests__/offline05-customer-idempotency.test.ts` | New — route-level dedupe tests (no DB) |
| `apps/pos-frontend/src/db.ts` | Dexie v3: `pendingCustomers` table |
| `apps/pos-frontend/src/offlineDb.ts` | Customer queue helpers + `rewritePendingSalesCustomerId` |
| `apps/pos-frontend/src/localStore.ts` | `deleteCustomerById` |
| `apps/pos-frontend/src/auth.ts` | `getAuthClaims()` |
| `apps/pos-frontend/src/POSScreen.tsx` | Held sales, customer search/create, and receipt all rewired per above |
| `apps/pos-frontend/src/__tests__/offlineDb.test.ts` | Extended — customer queue + `rewritePendingSalesCustomerId` tests, table list updated |
| `apps/pos-frontend/src/__tests__/localStore.test.ts` | New — held-sale and customer-cache CRUD, including reload-persistence |
| `apps/pos-frontend/src/__tests__/auth.test.ts` | Extended — `getAuthClaims()` tests |

## Tests: 64/64 PASS | type-check: PASS | build: PASS | lint: no new issues (pre-existing repo-wide gap unaffected)
- `@erp/pos-frontend test`: 34/34 (was 19 before this phase: 11 new in `offlineDb.test.ts`
  covering the customer queue + id-rewrite, 7 new in `localStore.test.ts`, 4 new in
  `auth.test.ts` for `getAuthClaims`).
- `@erp/sales-service test`: 61/61 passed, 21 pre-existing DB-gated skipped (no live
  Postgres this session — Docker Desktop unreachable, same gap as every session since
  ES-22, see `[[es24_no_live_db_available]]`). 3 new tests in
  `offline05-customer-idempotency.test.ts` (fresh creation, retried-operationId dedupe,
  unrelated-constraint-violation not swallowed), using the exact `Fastify` +
  script-based-mock-db harness `offline02-pos-sale-idempotency.test.ts` already
  established — no live DB needed for these.
- `pnpm --filter @erp/pos-frontend build` / `type-check`: PASS.
- `pnpm --filter @erp/sales-service type-check`: PASS (required rebuilding `@erp/db`
  first — `dist/` is gitignored and downstream services resolve the package via its
  built `dist/index.d.ts`, not `src/`, so the new `clientOperationId` field wasn't visible
  to `tsc` until `pnpm --filter @erp/db build` ran).
- `pnpm lint`: both touched packages still show the same pre-existing, previously
  documented repo-wide gap (`eslint.config.mjs` declares no Node/browser globals —
  `window`/`navigator`/`crypto`/`fetch`/`process` etc. all error as `no-undef` across
  the entire monorepo; see `[[preexisting_lint_debt]]`). Confirmed no new error categories:
  every flagged line in files this phase touched is either pre-existing code or a new
  `crypto.randomUUID()`/`window.print()` call following the exact same pattern that
  already errors identically everywhere else in these files.

## Known Issues / Deferred
- **Migration 0032 not yet applied to the dev DB** — Docker Desktop was unreachable this
  session (same recurring gap noted in OFFLINE-04's and earlier phases' completion
  reports). Run `pnpm --filter @erp/db db:migrate` once Postgres is up, then re-run the
  3 route-level idempotency tests plus a manual offline-customer-creation smoke test
  end-to-end.
- **No browser/E2E verification this session** — same Docker/no-live-environment
  constraint; the offline persistence, sync-ordering, and receipt behavior are verified at
  the unit level (Dexie via `fake-indexeddb`, route-level via mocked db) but not clicked
  through in a real browser against a running backend. Recommend a manual pass (airplane
  mode toggle, park/resume, offline customer creation, reconnect-and-sync, receipt print)
  before this reaches a real store.
- **Held-sale customer link can go stale in one narrow race**: if a held sale references a
  customer created offline, and that customer later syncs and its negative placeholder id
  is replaced, resuming the (still-unsynced) held sale afterward will show "no customer
  selected" instead of the original customer — the cart items are unaffected. Not treated
  as a fix in this phase (held sales are local-only/non-financial, unlike the
  sale-payload case which is fixed via `rewritePendingSalesCustomerId`); flagging for
  awareness rather than leaving silently undiscovered.
- **Returns/Exchange** remain delegated to `web-frontend`, online-only, per the phase's
  explicit out-of-scope list.
- **Cross-terminal held-sale visibility** — resolved as: not required (single-terminal
  design, confirmed with user before implementation); the backend audit-copy POST is
  best-effort only and not read back by any other terminal in this phase.
- **WhatsApp/Email receipt delivery** remains online-only and unqueued, per the phase's
  explicit scope (only the on-screen printable receipt was in scope).
