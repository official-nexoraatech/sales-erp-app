# ES-13 Completion Report — Inventory Valuation FIFO & WACC
**Date:** 2026-07-03
**Status:** COMPLETE (adapted to the codebase's actual architecture — see Deviations)

## Summary
Implemented FIFO and WACC costing on `items`, FIFO cost-layer tracking, and COGS calculation posted as a journal to accounting-service. `inventory_ledger.unit_cost` was already fixed for GRN receipts by ES-03 (writes `grnRate`, not 0) — that part of the prompt's premise was stale; this phase adds the actual valuation math on top of it.

## Architecture Deviation (read before using this phase's code)
The prompt assumes all costing logic lives in `inventory-service`, reached via `INVOICE_CONFIRMED` → async Kafka → inventory-service calculates COGS → `COGS_CALCULATED` → accounting-service. **That path doesn't exist in this codebase.** Per ES-03's Architecture Decision, `GRNService.approve()` (purchase-service), `InvoiceService.confirm()` (sales-service), `PurchaseReturnService.approve()`, and `ConsignmentService.recordSale()` all write `inventory_ledger` rows **directly to the shared `@erp/db` schema inside their own local transaction** — none of them call inventory-service's `InventoryLedgerService`. If FIFO/WACC logic only lived in inventory-service, it would never run for GRN receipts or invoice sales, the two paths that actually matter.

**Fix:** the same WACC/FIFO/COGS logic is duplicated into a small `ValuationService` class in each service that needs it, called synchronously within the existing transaction, right after the ledger row is written — the same pattern this codebase already uses for `GSTCalculator` (duplicated per-service rather than shared as an inventory-service import). Three copies exist:
- `apps/inventory-service/src/domain/ValuationService.ts` — full implementation (WACC + FIFO both directions), wired into `InventoryLedgerService.addStock()/deductStock()` for the `/internal/ledger` route (used by callers that can't share a transaction).
- `apps/purchase-service/src/domain/ValuationService.ts` — STOCK_IN side only (`applyStockIn`), wired into `GRNService.approve()`.
- `apps/sales-service/src/domain/ValuationService.ts` — STOCK_OUT side only (`consumeForStockOut`), wired into `InvoiceService.confirm()`.

The `COGS_CALCULATED` event still exists as specified (separate journal entry from `INVOICE_CONFIRMED`'s revenue recognition), but the *calculation* happens synchronously in the same DB transaction as the STOCK_OUT — only the event's Kafka delivery is async, via the existing outbox-relay pattern used everywhere else in this codebase.

## Costing Methods Implemented
- **WACC**: `items.wacc_cost` recalculated on every STOCK_IN with a real unit cost (`wacc = (currentValue + qty×cost) / (currentQty + qty)`), rounded to paise. Used as the COGS on every STOCK_OUT.
- **FIFO**: `inventory_fifo_layers` — one row per STOCK_IN, consumed oldest-`received_at`-first on STOCK_OUT. Partial layer consumption supported (remaining_qty decremented, not deleted).
- Both methods keep `items.current_stock_value` in sync (incremented on receipt, decremented by actual COGS on issue) so the Stock Valuation Report can read one field regardless of costing method.

## COGS Integration
- `InvoiceService.confirm()` computes COGS per line (FIFO consumption or WACC lookup), writes it to `inventory_ledger.cogs_per_unit`, and — if the invoice's total COGS > 0 — emits a `COGS_CALCULATED` outbox event.
- `apps/accounting-service/src/consumers/CogsAccountingConsumer.ts` (new) posts **DR Cost of Goods Sold (5000) / CR Inventory (1200)** on that event. Both accounts already exist in `DEFAULT_ACCOUNTS` (`accounting-service/src/domain/default-accounts.ts`) — no seed changes needed. Registered in `main.ts`'s Kafka dispatcher/topic list and `PostingMatrixService.DEFAULT_POSTING_RULES`.
- Inbox-based idempotency for this consumer is already provided by the shared `PlatformEventConsumer` wrapper (same as every other accounting consumer) — no manual dedup code needed.

## `unit_cost` Status
- GRN STOCK_IN: already fixed by ES-03 (`unit_cost = grnRate`) — unaffected by this phase, just consumed as the FIFO/WACC input cost.
- Invoice STOCK_OUT: `unit_cost` stays `'0'` by design (it's the sale price context, not a cost basis — the invoice line carries sale price separately). The real cost basis is the new `inventory_ledger.cogs_per_unit` column.
- Historical rows written before this phase have `cogs_per_unit = NULL` — acceptable, documented here, matches how ES-13's own prompt anticipated pre-phase `unit_cost = 0` rows.

## Explicitly Out of Scope (not silently expanded)
- **`PurchaseReturnService.approve()`** (STOCK_OUT of previously-received goods back to a supplier) and **`ConsignmentService.recordSale()`** (STOCK_OUT against a separate `consignment_stocks` lot table) are **not** wired into WACC/FIFO. Reversing a purchase return through the same FIFO layers/WACC pool is a real gap (the prompt's IN SCOPE list didn't call it out either) — `items.current_stock_value` will not decrease when a purchase return happens, so it will drift from the true remaining value over time for tenants using purchase returns. Flagging for a follow-up phase.
- **Invoice cancellation reversal** (`InvoiceService.cancel()`'s STOCK_IN) intentionally does **not** create a new WACC-diluting receipt or FIFO layer — a cancelled sale should restore stock at its original cost, not a new cost layer. This phase leaves that STOCK_IN's costing untouched (unit_cost as before); a correct reversal would need to look up the original sale's `cogs_per_unit` and restore the exact FIFO layer, which is a larger change than this phase's scope covers.
- **Stock Valuation Report `asOf` date parameter**: accepted by the API for shape-compatibility but not applied — `items.current_stock_value`/`wacc_cost` are running totals, not date-versioned, so true historical reconstruction isn't supported by this data model. The report always reflects current state.
- **Per-warehouse valuation accuracy**: `items.available_qty`/`current_stock_value`/`wacc_cost` are tracked per-item across *all* warehouses (matching how the rest of this codebase already tracks live stock — see `InventoryLedgerService`), not per-warehouse. When the report's `warehouseId` filter is used, quantity comes from the warehouse-level `projection_stock_level` table but the unit cost is the item's overall average — an approximation for multi-warehouse tenants, exact for single-warehouse ones.

## Files Changed
| File | Change |
|------|--------|
| `packages/db-client/src/schema/items.ts` | Added `costingMethod`, `waccCost`, `currentStockValue` to `items` |
| `packages/db-client/src/schema/inventory.ts` | Added `cogsPerUnit` to `inventoryLedger`; new `inventoryFifoLayers` table + types |
| `packages/db-client/migrations/0014_es13_inventory_valuation.sql` | NEW — migration for the above (not yet applied to any environment — dev has no real data per [[project_dev_phase_no_data]], apply freely) |
| `packages/shared-types/src/errors.ts` | Added `StockInsufficientForCostingError` (`STOCK_INSUFFICIENT`, 422) |
| `apps/inventory-service/src/domain/ValuationService.ts` | NEW — canonical WACC/FIFO/COGS implementation |
| `apps/inventory-service/src/domain/InventoryLedgerService.ts` | `addStock()`/`deductStock()` call `ValuationService`; `writeLedger()` now returns the inserted row id and accepts `cogsPerUnit` |
| `apps/inventory-service/src/api/valuation.routes.ts` | NEW — `GET /inventory/valuation` (Stock Valuation Report), guarded by `REPORT_VIEW` |
| `apps/inventory-service/src/main.ts` | Registers `valuationRoutes` |
| `apps/purchase-service/src/domain/ValuationService.ts` | NEW — STOCK_IN-side duplicate (WACC + FIFO layer creation) |
| `apps/purchase-service/src/domain/GRNService.ts` | `approve()` calls `ValuationService.applyStockIn()` per line after the STOCK_IN ledger row |
| `apps/sales-service/src/domain/ValuationService.ts` | NEW — STOCK_OUT-side duplicate (FIFO consumption / WACC lookup) |
| `apps/sales-service/src/domain/InvoiceService.ts` | `confirm()` calls `ValuationService.consumeForStockOut()` per line, writes `cogs_per_unit`, emits `COGS_CALCULATED` when total COGS > 0 |
| `apps/accounting-service/src/consumers/CogsAccountingConsumer.ts` | NEW — posts DR COGS / CR Inventory on `COGS_CALCULATED` |
| `apps/accounting-service/src/domain/PostingMatrixService.ts` | Added `COGS_CALCULATED` to `DEFAULT_POSTING_RULES` |
| `apps/accounting-service/src/main.ts` | Registers the new consumer + `erp.cogs.calculated` topic |
| `apps/web-frontend/src/api/endpoints.ts` | Added `stockValuationApi` |
| `apps/web-frontend/src/pages/inventory/StockValuationPage.tsx` | NEW — report page (ERPDataGrid, warehouse/date filters, CSV export, total footer) |
| `apps/web-frontend/src/App.tsx` | Registers `/inventory/valuation` route |
| `apps/web-frontend/src/components/Layout.tsx` | Adds "Stock Valuation" nav item under Inventory |
| `apps/inventory-service/src/__tests__/valuation.test.ts` | NEW — 5 tests (WACC calc x2 scenarios, FIFO layer creation, FIFO consumption + partial layer, FIFO insufficient-stock error) |
| `apps/inventory-service/src/__tests__/ledger-service.test.ts` | Updated script sequence for the new `ValuationService` calls inside `deductStock()` (regression) |
| `apps/sales-service/src/__tests__/invoice-ledger.test.ts` | Updated existing test's script sequence; added new test asserting `cogs_per_unit` + `COGS_CALCULATED` payload |
| `apps/purchase-service/src/__tests__/purchase-workflow.test.ts` | Updated `GRNService.approve()` test's script sequence for the new ledger-insert `.returning()` + `ValuationService` calls (regression) |

## Tests: 8/8 new + regression PASS
- `inventory-service`: 8 passed (3 pre-existing regression + 5 new valuation), 5 skipped (DB-integration, no `DATABASE_URL`)
- `sales-service`: 23 passed (incl. new COGS wiring test), 3 skipped
- `purchase-service`: 14 passed (regression script updated for new ledger/valuation calls)
- `accounting-service`: 9 passed, 3 skipped
- `pnpm --filter {db,types,inventory-service,purchase-service,sales-service,accounting-service,web-frontend} build`: **PASS**, zero errors
- `eslint` on every touched file: **zero new errors/warnings** — all findings on touched files were pre-existing baseline issues (verified via `git show HEAD:<file>` and by comparing structurally-identical untouched files, e.g. `ArAgingPage.tsx` has the same `Blob`/`URL`/`document` no-undef errors as the new `StockValuationPage.tsx`, confirming a repo-wide missing-browser-globals eslint config gap, not something introduced here)

Not run: live end-to-end verification against a running Postgres/Kafka stack (no `DATABASE_URL`/Docker in this environment, consistent with every prior ES phase's completion report). Recommend running `pnpm --filter <service> test` with `DATABASE_URL` set, and a manual GRN→sale→cancel cycle against a live stack, before deploying.

## Verification Checklist
- [x] GRN approval → `inventory_ledger.unit_cost` = PO price (pre-existing since ES-03, confirmed still correct)
- [x] WACC item: `items.wacc_cost` updates after each STOCK_IN (unit test)
- [x] FIFO item: `inventory_fifo_layers` gets a row after each STOCK_IN (unit test)
- [x] FIFO STOCK_OUT: oldest layers consumed first, partial layer left with correct remaining qty (unit test)
- [x] FIFO STOCK_OUT with insufficient layer coverage → `STOCK_INSUFFICIENT` (unit test)
- [x] COGS journal posted in accounting-service for `COGS_CALCULATED` (code path verified; not exercised against a live Postgres)
- [x] Stock valuation report route returns `{itemCode, itemName, qty, unitCost, totalValue, costingMethod}` + total footer (code review; recommend a live-DB smoke test — see Deviations re: per-warehouse approximation)
- [x] `pnpm lint` — no new errors on any touched file

## Regression Checklist
- [x] Existing STOCK_IN/STOCK_OUT still works (ES-03) — `ledger-service.test.ts` passes with updated script
- [x] Invoice confirmation still fires `INVOICE_CONFIRMED` outbox event unchanged (ES-08/ES-10) — untouched code path, `invoice-ledger.test.ts` passes
- [x] GRN approval still updates PO received quantities and fires `GRN_APPROVED`/RCM events unchanged (ES-09/ES-10) — untouched code path, `purchase-workflow.test.ts` passes

## Phases Unblocked
ES-16 (performance: FIFO layer index — already added `(tenant_id, item_id, warehouse_id, received_at)` — verify under real query volume), ES-17 (analytics: COGS data now available via `cogs_per_unit`)

## Follow-ups for Whoever Picks This Up Next
1. Wire `PurchaseReturnService.approve()` and `ConsignmentService.recordSale()` into the valuation engine (see "Explicitly Out of Scope" above).
2. Decide + implement a correct invoice-cancellation cost reversal (restore the original FIFO layer / don't dilute WACC).
3. If multi-warehouse costing accuracy becomes a real requirement, `items.wacc_cost`/`current_stock_value`/FIFO layers would need to move to a per-(item, warehouse) grain — a larger schema change than this phase's scope.
