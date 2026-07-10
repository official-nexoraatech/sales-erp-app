# ES-03 Completion Report — Inventory Ledger Integrity
**Date:** 2026-07-03
**Status:** COMPLETE

## Summary
Fixed four places where `items.available_qty` was updated without a corresponding `inventory_ledger` row: invoice confirmation (sales-service), purchase return approval (purchase-service), GRN approval (purchase-service), and consignment sale (production-service). Every stock-moving operation now writes an append-only ledger row in the same DB transaction as the quantity change, so `inventory_ledger` is a complete audit trail again.

## Architecture Decision (cross-service atomicity)
The prompt's Architecture Rule #3 asks for a decision between (A) async outbox-triggered ledger write, or (B) shared-transaction write, since a synchronous HTTP call to inventory-service's `/internal/ledger` cannot be rolled back if the caller's local transaction later aborts (a real HTTP POST can't be undone by a Postgres `ROLLBACK`), and the prompt's own Definition of Done requires "ledger write failure causes full transaction rollback."

**Decision: Option B, via the shared `@erp/db` schema package rather than importing inventory-service's TypeScript classes.** All services already connect to one physical PostgreSQL database (single `DATABASE_URL` across all `.env` files) and already write directly to `items` (conceptually inventory-service's table) from sales-service/purchase-service via the shared `packages/db-client` schema — this is the codebase's existing pattern, not something new. `InvoiceService.confirm()`, `PurchaseReturnService.approve()`, `GRNService.approve()`, and `ConsignmentService.recordSale()` each insert into `inventoryLedger` (imported from `@erp/db`) inside their existing `trx` transaction, immediately after the `items.available_qty` update. No inventory-service application code is imported — only the shared schema, matching how `items` is already used across service boundaries in this codebase. This satisfies real atomicity: a Postgres rollback undoes both the qty change and the ledger row together, and the "atomicity test" required by this phase actually works (a real HTTP call could not pass that test).

The `POST /internal/ledger` route was still built on inventory-service as scoped, for any future caller that can't share this database/transaction (e.g. a genuinely remote service or async job) — it dispatches to the existing `InventoryLedgerService.addStock()/deductStock()/adjustStock()` methods.

## Correction to the ES-03 prompt
The prompt's Fix 2 said purchase-return approval should write `movement_type = 'STOCK_IN'` ("after qty is restored"). The actual code in `PurchaseReturnService.approve()` **decrements** `available_qty` — correct, since a purchase return sends goods back to the supplier and reduces our inventory. Labeling a decrease as `STOCK_IN` would break the ledger reconciliation formula this same phase requires (`available_qty = initial − SUM(STOCK_OUT) + SUM(STOCK_IN)`). Implemented as `STOCK_OUT` instead, with a comment explaining why.

## `InventoryLedgerService.recordMovement()` — signature mismatch with existing code
The prompt assumes a single `recordMovement(type, itemId, warehouseId, quantity, unitCost, referenceType, referenceId, tenantId, tx?)` method. The actual `InventoryLedgerService` (already existed, more mature than the prompt anticipated) instead has `addStock()` / `deductStock()` / `adjustStock()` / `transferStock()`, each of which already does the qty update + ledger write + projection update atomically. `/internal/ledger` dispatches `STOCK_IN`→`addStock`, `STOCK_OUT`→`deductStock`, `ADJUSTMENT`→`adjustStock`, reusing this existing logic rather than adding a duplicate `recordMovement()` method.

## Files Changed
| File | Change |
|------|--------|
| `apps/sales-service/src/domain/InvoiceService.ts` | Modified — `confirm()` now writes a `STOCK_OUT` `inventory_ledger` row per line, in the same transaction as the `available_qty` deduct. `unit_cost` written as `0` — ES-13 (FIFO/WACC) owns real costing. |
| `apps/purchase-service/src/domain/PurchaseReturnService.ts` | Modified — `approve()` now writes a `STOCK_OUT` ledger row per return line (see "Correction" above); `unit_cost` = the return line's `unitPrice`. |
| `apps/purchase-service/src/domain/GRNService.ts` | Modified — `approve()` now writes a `STOCK_IN` ledger row per GRN line; `unit_cost` = the line's `grnRate`. Previously updated `available_qty` only, with no ledger write at all. |
| `apps/production-service/src/domain/ConsignmentService.ts` | Modified — `recordSale()` gained a required `warehouseId` parameter (previously missing from the signature entirely — the method has no caller anywhere in the codebase yet) and now also reduces `items.available_qty` on the main warehouse and writes a `STOCK_OUT` ledger row per consignment stock lot consumed (FIFO), `referenceType = 'CONSIGNMENT_SALE'`, `unit_cost` = the lot's `agreedRate`. Previously only adjusted the separate `consignment_stocks.available_qty` tracking table — main-warehouse stock and the ledger were both untouched. |
| `apps/inventory-service/src/api/internal.routes.ts` | NEW — `POST /internal/ledger`, guarded by `x-internal-key`, dispatches to `InventoryLedgerService.addStock/deductStock/adjustStock`. |
| `apps/inventory-service/src/main.ts` | Modified — registers `internalRoutes` under `/api/v2`. |

No new migration was needed — `inventory_ledger` already had the full required schema (`quantity_before`, `quantity_after`, `reference_line_id`, etc., a superset of what the prompt specified).

## Tests Added
- `apps/sales-service/src/__tests__/invoice-ledger.test.ts` — 2 tests: STOCK_OUT row written per line inside the transaction; ledger-insert failure propagates and rejects `confirm()` (atomicity)
- `apps/purchase-service/src/__tests__/purchase-return-ledger.test.ts` — 2 tests: STOCK_OUT row written per return line; ledger-insert failure rejects `approve()`
- `apps/inventory-service/src/__tests__/ledger-service.test.ts` — 3 tests: `deductStock()` writes a ledger row; insufficient stock throws (not silent); item-not-found throws (not silent)

No test exists yet for `GRNService.approve()` or `ConsignmentService.recordSale()` specifically — not in the phase's required test list, but worth adding in a follow-up if `production-service`/`purchase-service` test coverage expands.

## Test Results
- `pnpm --filter @erp/sales-service test`: **PASS** — 22 passed, 3 skipped (pre-existing DB-integration tests, skipped without `DATABASE_URL`)
- `pnpm --filter @erp/purchase-service test`: **PASS** — 2 passed (first tests this package has ever had — no `__tests__` dir existed before)
- `pnpm --filter @erp/inventory-service test`: **PASS** — 3 passed, 5 skipped (pre-existing DB-integration tests)
- `pnpm --filter @erp/production-service test`: no test files (pre-existing state, unchanged)
- `pnpm --filter {sales,purchase,inventory,production}-service type-check`: **PASS**, zero errors, on all four
- `pnpm --filter {sales,purchase,inventory,production}-service build`: **PASS**, zero errors, on all four
- `pnpm lint` on the four touched services: zero **new** errors/warnings introduced by this phase (verified via `git diff` — pre-existing `no-undef` errors for `process`/`crypto`/`fetch` across the whole codebase are a known baseline gap noted in ES-01; my one new file, `internal.routes.ts`, got the documented `/* global process, crypto */` fix and lints clean)

## Verification Results
- [x] Confirm invoice → `inventory_ledger` gets one `STOCK_OUT` row per line (verified via unit test; not run against a live Postgres in this session — no `DATABASE_URL` available)
- [x] Each row: correct `movement_type`, correct qty, non-null `unit_cost` (written as `0`, see ES-13 note below)
- [x] `available_qty` reconciles with ledger sum by construction (`quantityBefore`/`quantityAfter` captured from the same atomic `UPDATE ... RETURNING`)
- [x] Purchase return approval → `STOCK_OUT` rows (corrected from the prompt's `STOCK_IN`, see above), `reference_type = 'PURCHASE_RETURN'`
- [x] Ledger write failure → rollback (verified at the code level via unit test: the insert is inside the same `trx`, and a real Postgres transaction rollback is guaranteed by the DB itself)
- [x] GRN approval → `STOCK_IN` rows, `reference_type = 'GRN'` (previously completely missing)
- [x] Consignment sale → `STOCK_OUT` rows, `reference_type = 'CONSIGNMENT_SALE'` (previously completely missing, and main-warehouse `available_qty` wasn't even touched)
- [x] All new unit tests pass
- [x] `pnpm lint` — no new errors from this phase's changes
- **Not run:** live end-to-end verification against a running Postgres/Docker stack — this environment has no `DATABASE_URL`/Docker available. Unit tests substitute for the integration-test checklist items; recommend running the full `pnpm --filter <service> test` with `DATABASE_URL` set (which will also un-skip the existing `item.integration.test.ts` and `customer.integration.test.ts`) before deploying.

## Issues Encountered
1. `packages/logger/src/erp-metrics.ts` has a pre-existing `exactOptionalPropertyTypes` TypeScript error (`register: Registry | undefined` not assignable) unrelated to this phase — blocks `pnpm --filter @erp/logger build`, but does not affect `type-check`/`build` of the services touched here (verified clean). Not fixed — out of scope for ES-03, flagging for whoever owns `packages/logger`.
2. `apps/purchase-service` and `apps/inventory-service` had no test files before this phase (purchase-service had zero `__tests__` files at all) — this phase's tests are the first for purchase-service.
3. This sandbox had no `node_modules` installed at session start (`pnpm install` had never been run, or was wiped) — ran `pnpm install` (~2m46s) before any build/test/lint could be verified. Worth checking whether prior ES completion reports' "pnpm test/build/lint: PASS" claims were actually executed in a working environment, since this one wasn't until now.

## Phases Now Unblocked
ES-08 (sales workflow — depends on this ledger route for invoice cancellation/sales return reversals), ES-09, ES-13, ES-16

## Notes for ES-13 (Inventory Valuation)
- `unit_cost` is currently written as `0` on every `STOCK_OUT` ledger row from `InvoiceService.confirm()` (sales side has no cost data — invoice lines only carry sale price). ES-13's FIFO/WACC engine needs to either backfill this from `inventory_ledger` `STOCK_IN` rows (which now carry real `unit_cost` from GRN's `grnRate` and purchase-return's `unitPrice`) or compute it at read time.
- `PurchaseReturnService` and `GRNService` STOCK_OUT/STOCK_IN rows do carry real unit costs (`grnRate`, `unitPrice`) — a good FIFO cost-layer source.
- `ConsignmentService.recordSale()` now requires a `warehouseId` parameter that didn't exist before — this method still has **no caller anywhere in the codebase**. Whoever wires up the actual consignment-sale trigger (POS? a sales-service consumer?) needs to pass a real warehouse ID; there's no "default warehouse" auto-lookup, by design (matches how every other method in this codebase takes `warehouseId` explicitly).
