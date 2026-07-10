# OFFLINE-03 — Local Database Upgrade (Dexie Migration + Reference-Data Stores)
## STATUS: ✅ COMPLETE (see `ERP-PLANNING/phase-completions/OFFLINE-03_COMPLETION.md`)
## Sprint: Offline-3 | Effort: Medium (3–5 days) | Risk: Medium (touches the one offline code path that currently works — regress carefully)
## Depends on: OFFLINE-02 (idempotency must land before more data flows through the offline queue)
## Unlocks: OFFLINE-04 (delta sync needs stores to sync into), OFFLINE-05 (feature breadth needs cached customers/catalog)
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §4, `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` (architectural decision #1)

---

## YOUR ROLE

You are the **Frontend Platform Engineer** building the local-storage foundation the
rest of the offline-first program depends on.

Today, `apps/pos-frontend`'s only local persistence is a single raw-IndexedDB object
store (`pending_sales`, in `offlineDb.ts`) holding queued sale payloads — nothing else.
There is no cached catalog, no cached customer list beyond a small SW-cached API
response, no held-sales persistence, no sync metadata. This phase replaces the raw
IndexedDB access with Dexie (a thin, well-established wrapper over the same native
IndexedDB API) and adds the additional object stores later phases need — without
discarding or breaking the one offline capability that already works.

**This phase is additive and migratory, not a rewrite.** The existing `pending_sales`
data model and its consumers (`queueSale`, `getPendingSales`, `deletePendingSale`, the
now-wired-up `incrementRetries` from OFFLINE-02) must continue to work — you're changing
the underlying access library and schema-versioning approach, not the sale-queueing
behavior itself.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §4 (local storage) and the roadmap's "Local storage: Dexie" decision in full, including the reasoning for choosing Dexie over raw IndexedDB and over a full local-first framework
- [ ] Read `apps/pos-frontend/src/offlineDb.ts` in full (as modified by OFFLINE-02 — re-read current state, don't assume it matches this document's earlier description)
- [ ] Read `apps/pos-frontend/package.json` — confirm no existing IndexedDB wrapper dependency, confirm current build tooling (Vite) supports adding Dexie without configuration changes
- [ ] Read `apps/pos-frontend/src/POSScreen.tsx` — every call site that touches `offlineDb.ts`'s exports, so the migration doesn't miss a consumer
- [ ] Read `apps/pos-frontend/src/sw.ts` — confirm the service worker doesn't also touch IndexedDB directly (per the current audit, it doesn't — it only does Cache API caching of two specific GET endpoints); if this has changed, account for it
- [ ] Identify what reference data the later phases will need cached locally (items/catalog, customers, price lists, taxes — per the roadmap) and read the corresponding backend schema shapes (`packages/db-client/src/schema/items.ts`, customer schema, pricing/tax schema) so the local store shapes are a reasonable mirror, not a redesign
- [ ] Run `pnpm --filter @erp/pos-frontend build` and confirm no test suite currently exists for this app (per the audit) — note whether OFFLINE-10 (testing phase) or this phase should add the first tests for the migrated store; recommend adding basic tests now for the migration itself even though the comprehensive suite is OFFLINE-10's job

---

## PROJECT CONTEXT

### Why Dexie, not a rewrite of the raw-IndexedDB approach, and not a full sync framework

Raw IndexedDB requires hand-written `onupgradeneeded` version-migration logic, manual
index management, and promise-wrapping boilerplate for every new object store — doable
for one store (`pending_sales` today), painful once you add four or five more with
different shapes and query patterns (catalog needs a barcode index, customers need a
name/phone search index, etc.). Dexie is the same underlying browser API with a
schema-versioning and query layer on top — it does not change what's stored or how the
backend syncs it, it changes how much boilerplate this phase and the next few require.

A full local-first sync framework (ElectricSQL, PowerSync, RxDB) was explicitly ruled
out in the roadmap: those frameworks want to own the sync protocol end-to-end, which
would mean redesigning the backend's sync API around their conventions rather than the
delta-sync/idempotency conventions OFFLINE-02/04 already establish, matching this
codebase's existing patterns. Don't relitigate that decision in this phase; if you find
a concrete reason Dexie is insufficient partway through, flag it in the completion
report rather than silently switching approaches.

### What stores this phase adds (schema only — populating them is OFFLINE-04/05's job)

This phase's job is the **local database layer and schema**, not the sync logic that
fills it. Define Dexie table schemas for:
- `pendingSales` (migrated from the existing `pending_sales` object store, same shape plus OFFLINE-02's `operationId`/`retries`/`status` fields)
- `catalogItems` (id, barcode, name, price, tenantId, updatedAt — indexed on barcode for scan lookup, matching the existing quick-items/barcode-lookup use case)
- `customers` (id, name, phone, tenantId, updatedAt — indexed for search)
- `priceLists` / `taxRates` (whatever shape the backend already uses for pricing/tax lookups relevant to POS sale calculation — check `InvoiceService.ts`'s pricing/tax logic to mirror field names, don't invent new ones)
- `heldSales` (for OFFLINE-05 — cart snapshot + metadata)
- `syncMeta` (per-store `lastSyncedAt`/cursor, for OFFLINE-04's delta-sync to resume from)

Leave these stores empty of business logic in this phase beyond basic CRUD helpers
(matching `offlineDb.ts`'s existing `queueSale`/`getPendingSales`/`deletePendingSale`
function-per-operation style) — the actual "fetch from server and populate" sync logic
is OFFLINE-04.

### Coding Standards
- TypeScript strict — no `any`; Dexie's TypeScript support (typed tables via
  `Dexie.Table<T, K>`) should be used, not loosely-typed generic access
- No `console.log` — use `packages/logger` if `pos-frontend` already has a logging
  convention; if it doesn't (check first), match whatever error-surfacing pattern
  `POSScreen.tsx` already uses (toasts) for user-facing failures, and note in the
  completion report if this app has no structured logging at all — that's a real gap
  worth flagging, not silently working around
- Preserve the existing file (`offlineDb.ts`) as the single entry point for all local-DB
  access from `POSScreen.tsx`, rather than having components import Dexie directly —
  this keeps the migration's blast radius contained to one file's internals

---

## OBJECTIVE

1. `apps/pos-frontend` depends on Dexie; `offlineDb.ts` is rewritten to use it internally while preserving its existing exported function signatures for `pending_sales` operations
2. New Dexie table schemas exist for catalog items, customers, price lists/taxes, held sales, and sync metadata — populated with data starting in OFFLINE-04/05, not this phase
3. Existing sale-queueing/sync behavior (as hardened by OFFLINE-01/02) is unchanged from the caller's perspective — this is an internal-implementation migration

---

## SCOPE

### Step 1 — Add Dexie, define the database class

Add `dexie` as a dependency in `apps/pos-frontend/package.json`. Create a single Dexie
database subclass (e.g. `apps/pos-frontend/src/db.ts` or wherever this app's convention
puts shared modules — check first) defining all tables from Step 2 in one versioned
schema (`this.version(1).stores({...})`), so future phases can bump the version number
for schema changes rather than each phase inventing its own migration mechanism.

### Step 2 — Migrate `pending_sales` into the new Dexie database

Rewrite `offlineDb.ts` to use the new Dexie table for pending sales instead of raw
`indexedDB.open(...)`. Preserve `queueSale`, `getPendingSales`, `deletePendingSale`,
`incrementRetries` (and any OFFLINE-02 additions like the stuck-item status field) as
the same exported function signatures — `POSScreen.tsx` should not need to change how it
calls these functions, only what's happening underneath.

**Data migration concern:** if a device already has sales queued in the old raw-IndexedDB
`pos-offline`/`pending_sales` store when this update ships, those records must not be
silently lost. Either write a one-time migration that reads the old store and imports
its rows into the new Dexie-managed store on first load, or confirm (and document in the
completion report) that this isn't a real-world concern for the deployment timeline —
don't silently assume away data loss without stating it.

### Step 3 — Add the new (empty, schema-only) reference-data stores

Define `catalogItems`, `customers`, `priceLists`/`taxRates`, `heldSales`, `syncMeta`
tables per the shapes in Project Context above. Add basic CRUD helper functions for each
(get-all, get-by-id/barcode, upsert, clear) in the same file or a small set of files
matching this app's existing organization — these are the primitives OFFLINE-04/05 will
call, not full feature implementations.

### OUT OF SCOPE
- Actually fetching reference data from the backend and populating these new stores —
  that's OFFLINE-04
- Held-sale UI/business logic — that's OFFLINE-05
- Any change to the sync protocol or idempotency behavior established in OFFLINE-01/02
- Changing `apps/pos-frontend/src/sw.ts`'s Cache-API-based caching of quick-items/
  customer-search — that's a separate mechanism (HTTP response caching) from this
  phase's IndexedDB/Dexie-based structured local database; they can coexist, don't
  merge them into one system in this phase

---

## TESTING REQUIREMENTS

1. `queueSale`/`getPendingSales`/`deletePendingSale`/`incrementRetries` behave identically to before the migration (same inputs → same outputs), verified against whatever test coverage OFFLINE-02 added, re-run against the new implementation
2. A device with pre-existing old-format queued sales (if the migration-on-first-load path is built) correctly imports them without loss or duplication
3. Each new table's basic CRUD helpers (upsert/get/clear) work correctly in isolation
4. The Dexie database opens successfully on a fresh (no prior data) browser profile and on one with pre-existing old-format data

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/pos-frontend build
pnpm --filter @erp/pos-frontend type-check
pnpm --filter @erp/pos-frontend test   # if OFFLINE-02 or this phase added a test runner/config — confirm one exists, add minimal vitest config if not, full suite is OFFLINE-10's job
pnpm lint
```

---

## VERIFICATION CHECKLIST

- [ ] `apps/pos-frontend` builds and runs with Dexie replacing raw IndexedDB access in `offlineDb.ts`
- [ ] Existing pending-sale queue/sync behavior is unchanged from `POSScreen.tsx`'s perspective
- [ ] Pre-existing queued sales (old raw-IndexedDB format) are not silently lost on upgrade — either migrated or the non-concern is explicitly documented
- [ ] New empty schema tables exist for catalog, customers, price lists/taxes, held sales, and sync metadata
- [ ] `pnpm lint` and `pnpm type-check` pass

---

## REGRESSION CHECKLIST

- [ ] OFFLINE-01's refresh-and-retry auth wrapper is unaffected
- [ ] OFFLINE-02's idempotency (`operationId`, retry/backoff, stuck-item state) behaves identically after the storage-layer migration
- [ ] The service worker's Cache-API caching (`sw.ts`) is untouched
- [ ] POS checkout flow (cart → complete sale → queue or direct POST) works identically end-to-end

---

## DEFINITION OF DONE

- [ ] `offlineDb.ts` runs on Dexie internally with unchanged external behavior for pending sales
- [ ] New reference-data table schemas exist and have basic CRUD helpers, ready for OFFLINE-04 to populate
- [ ] Any pre-existing queued sales are safely migrated or the non-concern is documented
- [ ] All tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-03_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-03 complete

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-03_COMPLETION.md`

```markdown
# OFFLINE-03 Completion Report — Local Database Upgrade
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## What Changed
- offlineDb.ts migrated to Dexie: [summary]
- New tables added: catalogItems, customers, priceLists/taxRates, heldSales, syncMeta

## Data Migration
- [Old-format queued sales: migrated on first load / confirmed non-concern and why]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- New tables are schema-only; populated starting in OFFLINE-04 (reference data) and OFFLINE-05 (held sales)
```
