# OFFLINE-03 Completion Report — Local Database Upgrade
**Date:** 2026-07-05
**Status:** COMPLETE

## What Changed

- Added `dexie` as a runtime dependency of `apps/pos-frontend` and `fake-indexeddb` as a
  dev dependency (needed to test Dexie under jsdom, which has no native IndexedDB — the
  old hand-rolled IDB fake used by OFFLINE-02's tests didn't implement enough of the API
  surface, e.g. `versionchange`/upgrade transactions, for Dexie to run against).
- New file `apps/pos-frontend/src/db.ts`: a single `PosDatabase extends Dexie` class,
  the app's one schema-versioning source of truth. It declares `version(1)` matching the
  pre-Dexie raw-IndexedDB schema exactly (`pending_sales: '++id'`) so Dexie recognizes an
  existing on-disk database instead of colliding with it, then `version(2)` which renames
  `pending_sales` → `pendingSales` and adds the five new reference-data tables. The
  `version(2).upgrade()` callback copies any rows already in `pending_sales` into
  `pendingSales` — this is the "old queued sales must not be lost" migration, done via
  Dexie's built-in versioned-upgrade mechanism rather than a hand-rolled first-load
  migration routine.
- `apps/pos-frontend/src/offlineDb.ts` rewritten to use `db.pendingSales` (a Dexie
  `Table`) internally. `queueSale`, `getPendingSales`, `deletePendingSale`,
  `incrementRetries`, `MAX_RETRIES`, and the `PendingSale` type are all still exported
  with identical signatures and behavior — `POSScreen.tsx`'s import line and every call
  site are unchanged.
- New file `apps/pos-frontend/src/localStore.ts`: get-all/get-by-id-or-barcode/upsert/
  clear CRUD helpers for each new table (`catalogItems`, `customers`, `priceListItems`,
  `taxRates`, `heldSales`, `syncMeta`). Not wired into any UI yet — OFFLINE-04 populates
  catalog/customer/price/tax data, OFFLINE-05 wires up held-sale UI.
- New tables (schema only, per Project Context field shapes):
  - `catalogItems` — mirrors `items` (packages/db-client/src/schema/master.ts): id,
    tenantId, itemCode, name, barcode (indexed), hsnCode, gstRate, cessRate, mrp,
    salePrice, unitId, categoryId, brandId, status, updatedAt.
  - `customers` — mirrors `customers` (same schema file): id, tenantId, branchId,
    displayName, phone (indexed), altPhone, email, customerType, updatedAt.
  - `priceListItems` — mirrors `priceListItems`: id, tenantId, priceListId (indexed),
    itemId (indexed), variantId, salePrice, minQty, discountPercent, updatedAt.
  - `taxRates` — the backend has **no separate tax-rate master**; GST/cess rates live
    directly on `items` (confirmed in `InvoiceService.ts`, which reads `l.gstRate`/
    `l.cessRate` off line items, not a rate table). This store mirrors those two fields
    keyed by `hsnCode`, for POS tax lookups that don't have a full cached item at hand.
    Documented here rather than inventing a backend concept that doesn't exist.
  - `heldSales` — id, tenantId, branchId, label, cart (json), customerId, createdAt,
    updatedAt. Note: `POSScreen.tsx` already has a *server-backed* held-sales feature
    (`useQuery(['pos-held-sales'...])` against `/pos/held-sales`, backed by migration
    `0027_pos_held_sales.sql`) — this local table is separate, for OFFLINE-05's
    offline-capable held-sale flow, and does not touch the existing online one.
  - `syncMeta` — store (primary key), lastSyncedAt, cursor. For OFFLINE-04's delta sync.

## Data Migration

Handled via Dexie's own versioned schema (`version(1)` → `version(2)` with `.upgrade()`),
not a custom first-load routine. A device with sales already queued in the old raw
`pending_sales` object store has them copied into `pendingSales` automatically the first
time it opens the app after this update; nothing is silently dropped. Verified by test
(see below) that recreates a raw pre-Dexie v1 database, seeds one legacy record, then
confirms it surfaces through `getPendingSales()` after the Dexie upgrade runs.

## Files Changed

| File | Change |
|---|---|
| `apps/pos-frontend/package.json` | + `dexie` dependency, + `fake-indexeddb` dev dependency |
| `apps/pos-frontend/src/db.ts` | New — Dexie database class, versioned schema, all table typings |
| `apps/pos-frontend/src/offlineDb.ts` | Rewritten to use Dexie internally; exported API unchanged |
| `apps/pos-frontend/src/localStore.ts` | New — CRUD helpers for the 5 new reference-data tables |
| `apps/pos-frontend/src/__tests__/offlineDb.test.ts` | Rewritten on `fake-indexeddb/auto`; same 5 OFFLINE-02 behavior tests plus 2 new OFFLINE-03 tests (fresh-open table list, legacy-data migration) |
| `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` | Marked OFFLINE-03 complete |
| `ERP-PLANNING/audit-phase-prompts/OFFLINE-03-DEXIE-LOCAL-DATABASE.md` | Status header updated |

`POSScreen.tsx` and `sw.ts` were **not modified** — confirmed no other file imports
`offlineDb.ts`'s internals or touches IndexedDB directly besides these two.

## Tests: 14/14 PASS | lint: no new errors beyond pre-existing monorepo-wide no-undef debt | type-check: PASS | build: PASS

- `pnpm --filter @erp/pos-frontend test` — 14/14 pass (7 pre-existing OFFLINE-01 auth
  tests unchanged, 5 pre-existing OFFLINE-02 queue/retry/stuck tests now running against
  Dexie with identical assertions, 2 new OFFLINE-03 tests).
- `pnpm --filter @erp/pos-frontend type-check` and `build` — both pass (this app's
  `build` script is `tsc --noEmit`, no bundling step to break).
- `pnpm --filter @erp/pos-frontend lint` — reports errors on `crypto`/`indexedDB`-style
  globals; confirmed by isolated before/after comparison that this is the same
  pre-existing "missing ESLint browser globals" issue documented from earlier phases
  (root `eslint.config.mjs` sets no `languageOptions.globals`, so every DOM/Web API
  reference in every file in this app — `window`, `fetch`, `document`, `caches`, etc. —
  already errors this way). The Dexie migration actually *reduced* `offlineDb.ts`'s own
  error count (3 → 1: `IDBDatabase`/`indexedDB`/`crypto` → just `crypto`) by removing
  direct IndexedDB API usage. Not fixed here — fixing the root ESLint config is a
  monorepo-wide change out of this phase's scope.

## Known Issues / Deferred

- New tables (`catalogItems`, `customers`, `priceListItems`, `taxRates`, `heldSales`,
  `syncMeta`) are schema-only with CRUD primitives in `localStore.ts`; nothing populates
  them yet. Fetching reference data from the backend is OFFLINE-04; held-sale UI/business
  logic is OFFLINE-05.
- This app has no structured logging convention (confirmed: no `packages/logger` usage
  anywhere in `pos-frontend`, only `react-hot-toast` for user-facing errors and no
  console-based logging either). Flagging as a real gap per the phase prompt's coding
  standards note — not addressed here since it's out of scope.
- `pnpm lint` monorepo-wide missing-globals debt (documented in prior phases) still
  applies to this app's files; not addressed here.
