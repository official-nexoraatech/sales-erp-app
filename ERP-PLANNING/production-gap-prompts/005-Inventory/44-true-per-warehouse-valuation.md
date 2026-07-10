# [PG-032] True per-warehouse stock valuation (FIFO/WACC)

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Inventory
**Priority:** Medium
**Complexity:** L — requires a schema change to make WACC natively per-warehouse, a migration/backfill path for existing tenants, and a rewrite of the valuation report to stop estimating
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/inventory-service, packages/db-client

---

## Overview

- **Business objective:** a multi-warehouse tenant (or a single-tenant business with more than one branch/warehouse) needs to know the true stock value sitting in each warehouse — for insurance, for branch-level P&L, for deciding where to consolidate slow-moving stock, and for audit purposes. Today, if two warehouses hold the same item at genuinely different average costs (e.g. one warehouse received a large low-cost batch, another only received small high-cost top-ups), the report silently applies the *tenant-wide* average cost to both, understating one warehouse's stock value and overstating the other's. This is a real accounting-accuracy gap, not just a UX one.
- **Current implementation:** the Stock Valuation Report lives at `GET /inventory/valuation` in `apps/inventory-service/src/api/valuation.routes.ts`, guarded by `requirePermission(PERMISSIONS.REPORT_VIEW)`. Its own header comment documents the simplification:
  ```ts
  // GET /inventory/valuation — Stock Valuation Report (ES-13)
  // Note: items.available_qty / current_stock_value / wacc_cost are tracked
  // per-item (across all warehouses), not per-warehouse — matches how the rest of
  // this codebase tracks live stock counters (see InventoryLedgerService). When
  // warehouseId is passed, qty is taken from the warehouse-level projection and
  // value is estimated proportionally from the item's overall average cost.
  ```
  The actual computation (same file):
  ```ts
  const overallQty = parseFloat(String(r.availableQty));
  const overallValue = parseFloat(String(r.currentStockValue));
  const qty = parseFloat(String(r.warehouseQty)); // real, from projectionStockLevel
  const unitCost = overallQty > 0 ? overallValue / overallQty : parseFloat(String(r.waccCost));
  const lineValue = Math.round(qty * unitCost * 100) / 100; // ESTIMATE — ratio applied, not tracked
  ```
  The *quantity* per warehouse is real (pulled from `projectionStockLevel`, a genuine CQRS read model). Only the *unit cost* is an estimate — it's the tenant-wide average cost applied uniformly to every warehouse's quantity.
- **Current architecture:** two costing methods exist side by side at different granularities:
  - **FIFO** (`apps/inventory-service/src/domain/ValuationService.ts`, `consumeFifoLayers()`) is genuinely warehouse-scoped already — the `inventory_fifo_layers` table (added in migration `0015_es13_inventory_valuation.sql`) carries a `warehouse_id` column, and layer consumption filters `WHERE warehouse_id = :warehouseId`. Row-level locking (`SELECT ... FOR UPDATE`) is applied to the candidate layer rows during consumption, and to the `items` row during `applyStockIn`, to prevent concurrent-consumption races.
  - **WACC** (Weighted Average Cost) is *not* warehouse-scoped: `wacc_cost` and `current_stock_value` are columns on the `items` table itself (added in the same migration), i.e. one running average per item, tenant-wide, regardless of how many warehouses hold it.
  - Quantity, separately, is already tracked per-warehouse via `projectionStockLevel` (a CQRS projection fed by Kafka stock events), which is what the valuation report's `warehouseQty` comes from.
- **Current limitations:** for `WACC`-costed items, "per-warehouse valuation" is 100% synthetic — real per-warehouse quantity multiplied by a cost that has no warehouse dimension at all. For `FIFO`-costed items, the underlying layer data *is* warehouse-scoped, but the valuation report doesn't currently take advantage of that — it still reads from the same tenant-wide `items.currentStockValue`/`waccCost` columns for its unit-cost estimate regardless of `costingMethod`, so even FIFO items get the proportional-estimate treatment in this specific report today.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `inventory_fifo_layers` table already has `warehouse_id` — this is the pattern to extend to WACC, not reinvent. Its consumption logic (`ValuationService.consumeFifoLayers()`) already demonstrates the row-locking convention (`SELECT ... FOR UPDATE`) that any new warehouse-scoped WACC mutation must copy.
  - `projectionStockLevel` already provides genuine per-warehouse quantity — this package does not need to touch quantity tracking at all, only cost tracking.
  - `ValuationService.applyStockIn()` / `consumeForStockOut()` are the two entry points where `items.waccCost`/`currentStockValue` are currently mutated tenant-wide; these are the functions that need a warehouse-scoped counterpart.
- **What should never be modified:** the FIFO layer consumption algorithm itself (`consumeFifoLayers`, oldest-first ordering) is correct and warehouse-scoped already — do not touch it beyond whatever the valuation report needs to read from it. The `projectionStockLevel` CQRS projection and its Kafka-driven update path are out of scope — quantity is not the problem here. The nightly ledger-vs-projection reconciliation job is unrelated and must not be touched.
- **Prior related work:** `ERP-PLANNING/audit-phase-prompts/ES-13-INVENTORY-VALUATION-FIFO-WACC.md` is the original design doc for the FIFO/WACC engine and documents the row-locking requirement that `ValuationService.ts` implements — read it before touching `ValuationService.ts` to avoid violating an existing concurrency-safety decision. `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §8 documents this exact gap ("warehouse-scoped stock valuation is a proportional estimate, not true per-warehouse costing").

## Architecture

- Extend the existing per-item WACC tracking to also be tracked per-(item, warehouse), while *keeping* the existing tenant-wide `items.waccCost`/`currentStockValue` columns as the authoritative "all warehouses combined" figure (still needed for P&L/COGS postings that don't care which warehouse an item shipped from, and for any code path that isn't warehouse-aware).
- Concretely: add a new table, e.g. `inventory_warehouse_valuation` (one row per tenant+item+variant+warehouse, holding `wacc_cost` and `stock_value` scoped to that warehouse), maintained by the same code paths that already update `items.waccCost` (`ValuationService.applyStockIn()` and `consumeForStockOut()`) — those functions already know the warehouse ID of the stock movement they're processing, so this is an additive write alongside the existing tenant-wide write, not a new data flow.
- For FIFO-costed items, no new table is needed for cost tracking — `inventory_fifo_layers.warehouse_id` already lets the valuation report compute a true warehouse-scoped weighted cost by summing `remaining_qty * unit_cost` grouped by `warehouse_id` directly from that table, instead of applying the item-level ratio. This is a query-side change only.
- `valuation.routes.ts` changes its unit-cost lookup to branch by `costingMethod`: FIFO items compute true warehouse cost from `inventory_fifo_layers` (grouped by warehouse), WACC items read the new `inventory_warehouse_valuation` row for that (item, warehouse) pair instead of the tenant-wide ratio estimate. If a WACC item somehow has no per-warehouse row yet (pre-migration data, see below), fall back to today's estimate rather than erroring, so the report degrades gracefully during rollout.
- Data flow: stock-in / stock-out events (already flowing through `ValuationService`) → write both the existing tenant-wide `items` columns *and* the new per-(item,warehouse) row → valuation report reads the per-warehouse row when present. No new Kafka topics or event types are needed; this is entirely internal to `inventory-service`'s existing stock-mutation code path.

## Database Changes

- **New table** `inventory_warehouse_valuation`: `id bigserial PK`, `tenant_id integer NOT NULL`, `item_id integer NOT NULL`, `variant_id integer`, `warehouse_id integer NOT NULL`, `wacc_cost numeric(15,2) NOT NULL DEFAULT 0`, `stock_value numeric(15,2) NOT NULL DEFAULT 0`, `updated_at timestamptz NOT NULL DEFAULT now()`, with a unique constraint on `(tenant_id, item_id, variant_id, warehouse_id)` (matching the existing nullable-`variant_id` pattern already used in `inventory_fifo_layers`) and an index on `(tenant_id, item_id, warehouse_id)` for the valuation report's lookup.
- **Migration:** next sequential file in `packages/db-client/migrations/`, i.e. `0035_pg032_warehouse_valuation.sql` (latest existing is `0034_organization_theme_config.sql`), following this repo's established migration-file convention (plain SQL, `CREATE TABLE IF NOT EXISTS`, matching the style of `0015_es13_inventory_valuation.sql`).
- **Backfill for existing tenants:** a one-time data-migration script (or a step in the same migration file, run as a follow-up `INSERT ... SELECT`) that seeds `inventory_warehouse_valuation` from today's best-available signal: for FIFO items, derive initial per-warehouse `wacc_cost`/`stock_value` directly from `inventory_fifo_layers` (group by warehouse, sum `remaining_qty * unit_cost`); for WACC items, seed every existing warehouse row with the *current* tenant-wide `items.waccCost` as a starting point (explicitly the same estimate the report already produces today) so historical reports don't regress — going forward, real per-warehouse divergence only accumulates from the migration date onward. This must be documented in the migration's SQL comment as "initial seed uses today's ratio-estimate; divergence tracked correctly from this point forward."
- **Rollback strategy:** the new table is purely additive (no existing column is dropped or renamed) — rollback is `DROP TABLE IF EXISTS inventory_warehouse_valuation;`. Because `valuation.routes.ts` falls back to the existing tenant-wide estimate when no per-warehouse row exists, rolling back the table does not break the report — it silently reverts to today's proportional-estimate behavior.

## Backend

- **`apps/inventory-service/src/domain/ValuationService.ts`:** extend `applyStockIn()` and `consumeForStockOut()` to also upsert the matching `inventory_warehouse_valuation` row (same warehouse ID already available in both functions' arguments) using the identical WACC-recompute formula currently applied to `items.waccCost`, just scoped to `(item_id, warehouse_id)` instead of `(item_id)`. Reuse the same `SELECT ... FOR UPDATE` row-locking discipline already used for the `items` row and FIFO layers, applied now to the `inventory_warehouse_valuation` row, to avoid the same concurrent-consumption races this file was built to prevent.
- **`apps/inventory-service/src/api/valuation.routes.ts`:** replace the ratio-estimate unit-cost calculation with a costing-method-aware branch:
  - `costingMethod === 'FIFO'` and `warehouseId` provided → query `inventory_fifo_layers` grouped by `warehouse_id` for that item to get a true warehouse-weighted cost.
  - `costingMethod === 'WACC'` and `warehouseId` provided → read `inventory_warehouse_valuation` for that `(item_id, warehouse_id)`; fall back to the existing ratio estimate only if no row exists yet (pre-backfill edge case), with the response explicitly flagging `estimated: true` on that line so callers can tell real from estimated figures during the migration window.
  - No `warehouseId` provided → unchanged, continues to use the existing tenant-wide `items.currentStockValue`/`waccCost` (this is correct — a request that spans all warehouses should sum real totals, which the tenant-wide columns already are).
- No new Kafka topics, outbox events, or CQRS projections — this stays entirely inside `inventory-service`'s existing stock-mutation transaction boundary. No new permission constant is needed; continue guarding with `PERMISSIONS.REPORT_VIEW` as today (note: a separate, unused `PERMISSIONS.STOCK_REPORT_VIEW` constant exists in `packages/shared-types/src/permissions.ts` but isn't wired to this route — out of scope to fix here, flagging only for awareness).
- Idempotency: the upsert into `inventory_warehouse_valuation` should use the same transaction as the existing `items` table update inside `ValuationService`, so a partial write (item updated, warehouse row not) is impossible.

## Frontend

- **`apps/web-frontend`'s Stock Valuation report page** (wherever it renders `GET /inventory/valuation` results — under the Inventory/Reports section) needs one additive change: surface the new `estimated: true` flag per line (e.g. a small "estimated" badge/tooltip) so users can distinguish genuinely-tracked per-warehouse values from any remaining fallback-estimated ones during the backfill transition period. No new page, route, or permission gating is needed — this is an additive annotation on an existing table/report component.

## API Contract

- `GET /inventory/valuation?warehouseId=<id>` — response shape unchanged at the top level (`{ data: [...], meta: {...} }`); each line item gains one new optional field: `estimated?: boolean` (present and `true` only when a warehouse-scoped figure isn't yet available and the report fell back to the old ratio estimate; omitted/`false` once real per-warehouse data exists for that item+warehouse).
- No other endpoint changes. No new endpoint is introduced — this is a compute-path change inside the existing route.

## Multi-Tenant Considerations

- `inventory_warehouse_valuation` carries `tenant_id` on every row and every query filters on it explicitly, per this repo's standard "no RLS, application-code-enforced isolation" convention. The unique constraint `(tenant_id, item_id, variant_id, warehouse_id)` prevents any cross-tenant collision. No feature-flag gating is needed — this is a correctness fix to an existing report available to any tenant with `REPORT_VIEW`, not a new opt-in capability.

## Integration

- **apps/inventory-service** only — this gap is entirely internal to this service (stock-mutation code path + one report route). No other of the 14 backend services reads or writes `inventory_warehouse_valuation`, and no cross-service event changes are needed. `accounting-service`'s COGS consumer continues to read the tenant-wide `items.currentStockValue`/`waccCost` exactly as it does today — untouched by this package.

## Coding Standards

This reuses the existing Fastify + Zod + Drizzle convention already used throughout `inventory-service`, the same row-locking pattern (`SELECT ... FOR UPDATE`) already established in `ValuationService.ts` for the FIFO layers and `items` row, and the same migration-file convention (`packages/db-client/migrations/NNNN_description.sql`) used by every prior inventory migration. No new framework or library is introduced.

## Performance

- The new `inventory_warehouse_valuation` table is small (one row per tenant × item × variant × warehouse combination that actually has stock — bounded by real business cardinality, not unbounded). The unique index `(tenant_id, item_id, variant_id, warehouse_id)` makes both the upsert-on-write and the read-in-report paths O(1) index lookups.
- The FIFO-costed branch of the valuation report now does a `GROUP BY warehouse_id` aggregate over `inventory_fifo_layers` per item — this table already has an index `idx_fifo_layers_consume_order (tenant_id, item_id, warehouse_id, received_at)` that covers this access pattern, so no new index is needed there.
- Row-level locking (`FOR UPDATE`) on the new table during stock-in/stock-out follows the same pattern already accepted for `items`/`inventory_fifo_layers` — no new concurrency bottleneck class is introduced, just an additional row to lock in the same transaction that already locks those.

## Security

Not a security-sensitive change — same permission (`PERMISSIONS.REPORT_VIEW`), same tenant-scoping discipline, no new PII or financial-instruction surface. The only "security-adjacent" consideration is data-integrity: the report must not silently present an estimate as if it were an exact figure, which is why the `estimated` flag is part of the API contract rather than an internal-only detail.

## Testing

- **Unit tests** in `apps/inventory-service/src/__tests__/`: extend or add a test file (e.g. `warehouse-valuation.test.ts`) covering: (a) `ValuationService.applyStockIn()`/`consumeForStockOut()` correctly upsert `inventory_warehouse_valuation` alongside the existing `items` update; (b) two warehouses receiving the same item at different costs end up with genuinely different `wacc_cost` rows (this is the core regression test proving the estimate is gone for WACC items going forward); (c) the FIFO branch of `GET /inventory/valuation` produces a true per-warehouse weighted cost that differs from the tenant-wide ratio when warehouses hold different-cost layers.
- **Integration test:** a migration/backfill test verifying the backfill step seeds `inventory_warehouse_valuation` without breaking existing valuation report output for tenants that existed before the migration (i.e. `estimated: true` shows for un-migrated combinations, `false` after the backfill runs).
- **Regression:** re-run the existing valuation-report tests (if any exist under `apps/inventory-service/src/__tests__/`) to confirm the no-`warehouseId` (tenant-wide) path is byte-for-byte unchanged.

## Acceptance Criteria

- [ ] Migration `0035_pg032_warehouse_valuation.sql` creates `inventory_warehouse_valuation` and runs cleanly against a fresh dev DB and against the existing dev DB with data.
- [ ] After the migration and backfill, a query against `inventory_warehouse_valuation` for a WACC-costed item held in two warehouses at genuinely different costs shows two different `wacc_cost` values (not the same tenant-wide ratio).
- [ ] `GET /inventory/valuation?warehouseId=<id>` for a FIFO-costed item returns a unit cost computed from that warehouse's actual FIFO layers, verifiably different from the tenant-wide average when layers differ by warehouse.
- [ ] `GET /inventory/valuation` with no `warehouseId` continues to return identical totals to before this change (tenant-wide figures unaffected).
- [ ] Rolling back the migration (`DROP TABLE inventory_warehouse_valuation`) leaves the valuation report functional, silently reverting to the pre-existing ratio-estimate behavior with `estimated: true` on every line.
- [ ] `pnpm --filter @erp/inventory-service test` and `typecheck` pass.

## Deliverables

- **Files to create:**
  - `packages/db-client/migrations/0035_pg032_warehouse_valuation.sql`
  - `apps/inventory-service/src/__tests__/warehouse-valuation.test.ts` (or extend an existing valuation test file)
- **Files to modify:**
  - `apps/inventory-service/src/domain/ValuationService.ts` (upsert per-warehouse WACC row in `applyStockIn`/`consumeForStockOut`)
  - `apps/inventory-service/src/api/valuation.routes.ts` (costing-method-aware unit-cost lookup, `estimated` flag)
  - `packages/db-client/src/schema/inventory.ts` (add `inventoryWarehouseValuation` Drizzle table definition)
  - Web-frontend Stock Valuation report component (surface `estimated` badge) — exact file to be located under `apps/web-frontend/src/pages/inventory` or `reports` at implementation time.
- **Migrations:** `0035_pg032_warehouse_valuation.sql` (new table + backfill).
- **APIs added/changed:** `GET /inventory/valuation` response gains optional per-line `estimated: boolean`.
- **Events added/changed:** none.
- **Tests added:** `warehouse-valuation.test.ts` (or equivalent), covering per-warehouse WACC divergence, FIFO per-warehouse cost, and backfill correctness.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `inventory-service` has a working FIFO/WACC valuation engine (`ValuationService.ts`, built in ES-13) with row-level locking for concurrency safety. FIFO layers (`inventory_fifo_layers`) already carry a `warehouse_id` column and are genuinely warehouse-scoped. WACC costing (`items.waccCost`/`items.currentStockValue`) is tenant-wide only, with no warehouse dimension. The Stock Valuation Report (`GET /inventory/valuation`) fakes per-warehouse values for WACC items by applying the tenant-wide cost ratio to a real per-warehouse quantity (from `projectionStockLevel`) — this is a self-documented simplification in the route file's own header comment.

**Current Objective:** make WACC valuation genuinely per-warehouse by adding a new `inventory_warehouse_valuation` table (mirroring the pattern FIFO already uses), wiring `ValuationService` to maintain it alongside the existing tenant-wide columns, and updating the valuation report to read real per-warehouse figures (for both FIFO and WACC) instead of estimating.

**Architecture Snapshot:** (1) quantity is already tracked per-warehouse via the `projectionStockLevel` CQRS projection — untouched by this package; (2) FIFO cost is already per-warehouse via `inventory_fifo_layers.warehouse_id` — this package makes the *valuation report* use that data properly rather than adding new FIFO tracking; (3) WACC cost needs the new table since `items.waccCost` has no warehouse dimension; (4) all stock mutations flow through `ValuationService.applyStockIn()`/`consumeForStockOut()`, which already know the warehouse ID of every movement — this is the single place to add the per-warehouse WACC upsert.

**Completed Components:** FIFO layer tracking with warehouse scoping and row-locking (ES-13). Tenant-wide WACC tracking (ES-13). The per-warehouse quantity projection (separate, earlier work).

**Pending Components:** everything in this package — the new table, the migration+backfill, the `ValuationService` write-path extension, and the report's read-path rewrite. Do not conflate this with fixing quantity tracking (already correct) or with COGS posting to `accounting-service` (reads tenant-wide `items` columns and is intentionally untouched).

**Known Constraints:** must not break the existing no-`warehouseId` (tenant-wide) report output — that path is correct today and must stay byte-for-byte identical. Must provide a graceful fallback (`estimated: true`) for any (item, warehouse) combination not yet backfilled, rather than erroring.

**Coding Standards:** reuse the exact row-locking (`SELECT ... FOR UPDATE`) pattern already in `ValuationService.ts`; reuse the migration file convention (`packages/db-client/migrations/NNNN_description.sql`); no new framework/library.

**Reusable Components:** `ValuationService.applyStockIn()`, `ValuationService.consumeForStockOut()`, `consumeFifoLayers()` (read-only reference for the FIFO-branch query pattern), `projectionStockLevel` (quantity source, read-only).

**APIs Already Available:** `GET /inventory/valuation` (route being modified, not replaced), `GET /inventory/stock/:itemId` (quantity source for context, unrelated to this change).

**Events Already Available:** none new needed — this is entirely inside `inventory-service`'s existing transactional stock-mutation code path, no new Kafka event type required.

**Shared Utilities:** `@erp/db` (Drizzle schema/client), `@erp/types` (permissions), `@erp/logger`.

**Feature Flags:** none — this is a correctness fix available to all tenants, not an opt-in feature.

**Multi-Tenant Rules:** every new table row and query must filter explicitly on `tenant_id` (no RLS in this codebase) — follow the exact same pattern as `inventory_fifo_layers`.

**Security Rules:** guard the (unchanged) route with `PERMISSIONS.REPORT_VIEW`, as it already is.

**Database State:** depends on migrations up through `0034_organization_theme_config.sql` being applied; this package adds `0035_pg032_warehouse_valuation.sql`.

**Testing Status:** `ValuationService.ts` has existing test coverage from ES-13 (concurrency/row-locking tests likely exist under `apps/inventory-service/src/__tests__/`) — extend rather than replace. No existing test covers per-warehouse WACC divergence (the entire point of this gap) — that's new.

**Next Session Plan:** single session is feasible if the schema/migration is written first, then `ValuationService` extension, then the report route, then tests, in that order — each step is independently testable.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/005-Inventory/44-true-per-warehouse-valuation.md` (PG-032): add the `inventory_warehouse_valuation` table (migration `0035_pg032_warehouse_valuation.sql`), extend `apps/inventory-service/src/domain/ValuationService.ts` to upsert per-warehouse WACC rows on every stock-in/stock-out, and rewrite `apps/inventory-service/src/api/valuation.routes.ts` to use real per-warehouse costs (FIFO from `inventory_fifo_layers` grouped by warehouse, WACC from the new table) instead of the current proportional-estimate ratio, with a backfill migration and an `estimated` fallback flag for any not-yet-migrated combination."
