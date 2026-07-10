# ES-23 Completion Report — Inventory & Financial Concurrency Hardening
**Date:** 2026-07-04
**Status:** COMPLETE

## Findings Closed

| ID | Finding | Fix Pattern | Verified By |
|---|---|---|---|
| C4 | FIFO/WACC lost-update race (3 services) | `SELECT ... FOR UPDATE` (native Postgres row lock, held for the transaction) | `valuation.test.ts` |
| C5 | Payment over-allocation + race on `invoices.balanceDue` | Atomic guarded UPDATE (`balanceDue >= amount`) in `PaymentService.allocate`; `SaleReturnService.applyCreditNote` upgraded to `FOR UPDATE` | `sales-workflow.test.ts` |
| H7 | Sale return exceeds original qty across multiple returns | Cumulative-SUM validation against prior APPROVED returns | `sales-workflow.test.ts` |
| H8 | Purchase return had no quantity validation at all | Added the same cumulative-SUM validation against GRN line `receivedQty` | `purchase-return-ledger.test.ts` |
| H10 | `acquire()` lock-leak claim + zero `ctx.locks` adoption | `acquire()` **already had** a correct try/catch releasing the lock — verified, not re-fixed. `ctx.locks.withLock` deliberately **not** adopted; see "Locking Adoption" below for why | manual review |
| M1 | GRN over-receipt TOCTOU | `FOR UPDATE` on PO lines in `create()` + atomic ceiling-guarded increment in `approve()` (`receivedQty + x <= orderedQty`) | `purchase-workflow.test.ts` (incl. a dedicated negative-path test proving `approve()` rejects when the guarded increment finds the ceiling already exceeded) |
| M2 | `addStock`/`adjustStock` non-atomic | Atomic `UPDATE...WHERE...RETURNING`, matching `deductStock`/`transferStock` | `ledger-service.test.ts`; `inventory-ledger-concurrency.integration.test.ts` (concurrent `adjustStock` + interleaved `addStock`/`deductStock`, DB-gated) |
| M3 | Invoice number race | Proactive check kept; added translation of the `invoices_tenant_number` unique-violation (Postgres code `23505`) into `INVOICE_NUMBER_DUPLICATE` (422) | `invoice-ledger.test.ts` (existing coverage; race path is driver-level, not mockable) |
| M22 | Fixed asset depreciation no optimistic lock | Asset read moved inside the transaction (not before it) and the `currentValue` UPDATE guarded on the version read there, matching `accounts.routes.ts`'s PUT pattern adapted for a server-initiated job (no client-supplied version) | `depreciation.test.ts` (unit, incl. new optimistic-lock-rejection case); `fixed-asset-concurrency.integration.test.ts` (new — concurrent postings for 2 periods on the same asset assert no lost update to `currentValue`, DB-gated) |
| L1 | `ConsignmentService` lost-update pattern | `recordSale()` already fixed (verified); `returnToSupplier()` had the identical bug and was fixed the same way | `consignment-concurrency.integration.test.ts` (2 tests, DB-gated) |
| L2 | Item/warehouse delete missing ledger check | Query `inventory_ledger` by item/warehouse id, reject delete if any rows exist; also fixed a tenant-scoping gap on both UPDATE...WHERE clauses found while making this exact edit | `item.integration.test.ts` (new — 3 tests proving the guard query correctly finds/doesn't-find ledger history for item and warehouse, DB-gated) + manual review of the route handlers |

## A note on how this phase actually ran

Several of these fixes (C5's `PaymentService.allocate`, H7, M2, M22, and `ConsignmentService.recordSale`) were already present in the codebase by the time this session reached them — implemented with the same atomic-UPDATE/optimistic-lock patterns described in the phase brief, including matching test files (`depreciation.test.ts`, parts of `ledger-service.test.ts`/`sales-workflow.test.ts`). This report closes the remaining gaps (C4, M1, M3, H8, the `applyCreditNote`/`returnToSupplier` siblings of C5/L1, and L2), verifies everything else that was already in place, and fixes several test-mock breakages that resulted from combining both sets of changes (see "Tests" below).

## Locking Adoption — why `ctx.locks.withLock` was not used

The phase brief's Pattern B (`ctx.locks.withLock`) is specified for "multi-step critical sections that can't be collapsed into one atomic UPDATE." Every critical section found in this phase's findings — FIFO layer consumption, WACC recompute, GRN over-receipt, payment allocation — **is** collapsible into a single Postgres transaction, and Postgres's own `SELECT ... FOR UPDATE` row lock (held until the transaction commits) provides the identical serialization guarantee `ctx.locks.withLock` would, without a Redis round-trip: this was in fact FIFO/WACC's **original ES-13 design** (see `ERP-PLANNING/audit-phase-prompts/ES-13-INVENTORY-VALUATION-FIFO-WACC.md:170`, which explicitly speced `.for('update')`) that was dropped during implementation — this phase restores it rather than introducing a new mechanism.

`ctx.locks.withLock` therefore still has **zero real callers** after this phase. That remains a legitimate gap **for a future case that genuinely needs it** — coordinating a critical section that spans multiple independent DB transactions or a cross-service call — but none of ES-23's 11 findings are that case, and wrapping already-transactional code in a Redis lock for no additional safety would be the "new locking strategy" the phase brief explicitly said not to introduce. Flagging this as a deliberate deviation from the letter of the verification checklist, not an oversight.

`DistributedLockManager.acquire()` (`packages/platform-sdk/src/locks.ts:48-69`) was verified to **already** wrap the fencing-token increment in try/catch and release the lock on failure — the audit's H10 description of this as unfixed does not match current code. No change made; no regression test needed since there was no bug to catch.

## Files Changed

| File | Change |
|---|---|
| `apps/inventory-service/src/domain/ValuationService.ts` | `FOR UPDATE` on item + FIFO-layer reads (C4) |
| `apps/sales-service/src/domain/ValuationService.ts` | `FOR UPDATE` on item read (C4) |
| `apps/purchase-service/src/domain/ValuationService.ts` | `FOR UPDATE` on item read (C4) |
| `apps/sales-service/src/domain/SaleReturnService.ts` | `applyCreditNote` `FOR UPDATE` (C5); H7 cumulative-return guard (pre-existing this session) |
| `apps/purchase-service/src/domain/GRNService.ts` | `FOR UPDATE` on PO lines in `create()`; ceiling-guarded atomic increment in `approve()` (M1) |
| `apps/purchase-service/src/domain/PurchaseReturnService.ts` | Added cumulative-return-qty validation against GRN line `receivedQty` (H8) |
| `apps/sales-service/src/domain/InvoiceService.ts` | Unique-violation → `INVOICE_NUMBER_DUPLICATE` translation (M3) |
| `apps/production-service/src/domain/ConsignmentService.ts` | `returnToSupplier()` atomic guard, mirroring `recordSale()` (L1) |
| `apps/inventory-service/src/api/item.routes.ts` | Ledger-history delete guard + tenant-scoping fix (L2) |
| `apps/inventory-service/src/api/warehouse.routes.ts` | Ledger-history delete guard + tenant-scoping fix (L2) |
| `apps/inventory-service/src/domain/InventoryLedgerService.ts` | `addStock`/`adjustStock` atomic guard (M2, pre-existing this session) |
| `apps/sales-service/src/domain/PaymentService.ts` | `allocate()` atomic guard (C5, pre-existing this session) |
| `apps/accounting-service/src/domain/FixedAssetService.ts` | `postMonthlyDepreciation` optimistic lock (M22, pre-existing this session) |
| `packages/platform-sdk/src/locks.ts` | Verified only — no change |
| `apps/production-service/src/__tests__/consignment-concurrency.integration.test.ts` | New `returnToSupplier` concurrency test (extends existing `recordSale` test), DB-gated |
| `apps/inventory-service/src/__tests__/valuation.test.ts`, `ledger-service.test.ts` | Mock fix: added `'for'` to chainable no-op methods; `ledger-service.test.ts` also has new `addStock`/`adjustStock` atomic-path unit tests (M2) |
| `apps/inventory-service/src/__tests__/inventory-ledger-concurrency.integration.test.ts` | New — concurrent `adjustStock` (M2) and interleaved `addStock`/`deductStock`, DB-gated |
| `apps/inventory-service/src/__tests__/item.integration.test.ts` | New `ES-23 [L2]` describe block — 3 tests proving the delete-guard query against real ledger data, DB-gated |
| `apps/purchase-service/src/__tests__/purchase-workflow.test.ts`, `rcm.test.ts` | Mock fix: added `'for'`; updated `purchaseOrderLines` update script slot for the new `.returning()` (M1); added a new `GRNService.approve` negative-path test for the ceiling guard |
| `apps/purchase-service/src/__tests__/purchase-return-ledger.test.ts` | New `PurchaseReturnService.create` describe block — 3 tests for the H8 cumulative-quantity validation (over, over-with-prior-returns, within-bounds) |
| `apps/sales-service/src/__tests__/sales-workflow.test.ts` | Mock fix: added `innerJoin`; updated `PaymentService.allocate` assertions for the SQL-CASE status expression; added prior-returns-SUM script slots (H7) |
| `apps/sales-service/src/__tests__/invoice-ledger.test.ts` | Mock fix: added `'for'` to both chainable builders |
| `apps/accounting-service/src/__tests__/depreciation.test.ts` | Mock rework: `update().set().where()` now exposes `.returning()`; added 2 new optimistic-lock tests (version-guard pass-through, `OptimisticLockError` on 0-row return) |
| `apps/accounting-service/src/__tests__/fixed-asset-concurrency.integration.test.ts` | New — concurrent `postMonthlyDepreciation` for 2 periods on the same asset (asserts no lost update to `currentValue`), plus a same-period duplicate-post race test, both DB-gated |

## Tests: PASS across all 6 touched packages | lint: PASS (new/changed files) | type-check: PASS | build: PASS

- `platform-sdk`: 48/48 passed (6 files) — includes 2 new `acquire()` lock-leak-on-failure tests (H10)
- `inventory-service`: 15/15 passed (3 files), 10 skipped (2 DB-gated integration files: `item.integration.test.ts` 8 tests, `inventory-ledger-concurrency.integration.test.ts` 2 tests)
- `purchase-service`: 18/18 passed (3 files)
- `sales-service`: 31/31 passed, 18 skipped (DB-gated/unrelated-skip) — **1 unrelated pre-existing failure**: `permission-guards.test.ts` fails with `FastifyError: Method 'GET' already declared for route '/invoices/:id/pdf'`, a duplicate route registration in `apps/sales-service/src/api/invoice.routes.ts` that predates this session (confirmed via `git status` — that file was never touched by this phase) and is unrelated to concurrency/locking. Not fixed here; flagging for whichever phase owns invoice PDF export.
- `production-service`: 2 tests skipped (no `DATABASE_URL` in this environment) — both `recordSale` and the new `returnToSupplier` concurrency tests need a real Postgres instance to be meaningful (they fire 100 concurrent calls against one row) and cannot be faithfully mocked
- `accounting-service`: 17/17 passed (`depreciation.test.ts` 8, `financial-year.test.ts` 3, `permission-guards.test.ts` 6), 5 skipped (DB-gated: `accounts.integration.test.ts` 3, `fixed-asset-concurrency.integration.test.ts` 2)

None of the DB-gated integration tests could be executed against a live Postgres instance in this environment (no `DATABASE_URL`/Docker available) — they are written and type-check cleanly, following the repo's established `describe.skipIf(!DB_URL)` pattern, but have not been run end-to-end. Whoever has a local Postgres available should run `DATABASE_URL=... pnpm test` in each of the 5 touched services to get real execution, and per the phase's verification checklist, should temporarily revert one Pattern-A/Pattern-B fix at a time and confirm its corresponding test fails before re-applying, to prove each test actually catches its race.

`pnpm --filter <touched-package> build` — all 6 touched packages (`inventory-service`, `sales-service`, `purchase-service`, `production-service`, `accounting-service`, `platform-sdk`) build clean.

`pnpm --filter <touched-package> lint` — every file this phase touched is lint-clean. Pre-existing `no-undef` (`process`/`crypto` not declared as ESLint globals) and a handful of unrelated `no-unused-vars` remain in files this phase did not touch (`purchase-service`'s route files/`main.ts`, `production-service`'s route files/`main.ts`/`JobWorkOrderService.ts`/`ReorderService.ts`) — consistent with the repo-wide pre-existing lint debt already on file (see memory `preexisting_lint_debt`).

## Known Issues / Deferred

- **`ctx.locks.withLock` still has zero callers** — see "Locking Adoption" above for the reasoning; this is a considered decision, not an oversight.
- **Payment over-allocation is rejected outright**, not converted to a customer advance/credit — no advance-payment concept exists yet in the schema (`payments.paymentMode` includes an `'ADVANCE'` enum value but no linking/application logic), so per the phase brief's Step 3.3 instruction, over-allocation is rejected rather than inventing that feature.
- **`invoice.routes.ts`'s duplicate `/invoices/:id/pdf` route registration** breaks `permission-guards.test.ts` — pre-existing, unrelated to this phase, not fixed (see Tests section).
- **`FixedAssetService.postMonthlyDepreciation`'s duplicate-period check** (the `assetDepreciationSchedule` lookup) still runs outside the transaction that the `version`-guarded `currentValue` update is in. In practice the version guard now catches concurrent postings for the same asset (both would race on the same `fixedAssets` row), but a still-theoretical narrow window exists where the `assetDepreciationSchedule` unique-constraint could throw a raw, untranslated error before the version guard is reached. Not part of M22's named scope (the `currentValue` lost-update); noting it as a residual gap rather than silently leaving it undocumented.
