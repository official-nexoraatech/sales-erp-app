# ES-23 — Inventory & Financial Concurrency Hardening
## STATUS: ✅ COMPLETE — see phase-completions/ES-23_COMPLETION.md
## Sprint: 5 | Effort: 4–5 days | Risk: Critical (silent financial/stock data corruption)
## Depends on: ES-03 (inventory ledger integrity), ES-08 (sales workflow), ES-09 (purchase/GRNI),
##             ES-13 (FIFO/WACC valuation)
## Unlocks: nothing blocked on this, but this is the #2 production blocker after ES-21
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings C4, C5, H7, H8, H10, M1, M2, M3,
##         M22, L1, L2

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP, focused on
inventory and sales/purchase financial correctness.

The 2026-07-03 architecture audit found that **the correct atomic-update pattern is already used
correctly in this codebase** (e.g. `items.availableQty` deduction is a proper guarded
`UPDATE...WHERE qty >= :req`) — but several nearby, structurally similar operations were built as
plain read-then-write, with no atomic guard and no lock. Under any real concurrent load (two
clerks, a retry, a double-click), these silently produce wrong numbers: negative-but-clamped-to-zero
balances, phantom stock, lost quantity, or double-restocking. There is no crash, no error, no log
line — just quietly wrong data that surfaces days later as a books-don't-balance incident.

**Your job is to make every listed operation match the atomic pattern that already exists two
functions away in the same file. Do not introduce a new locking strategy — extend the existing one
(`ctx.locks.withLock` from `packages/platform-sdk`, or the atomic-`UPDATE...WHERE...RETURNING`
pattern) consistently.**

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §2 (C4, C5), §3 (H7, H8, H10), §4 (M1, M2,
      M3, M22), §5 (L1, L2)
- [ ] Read `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md`, `ES-08_COMPLETION.md`,
      `ES-09_COMPLETION.md`, `ES-13_COMPLETION.md` — what these phases already claimed fixed
- [ ] Read `apps/inventory-service/src/domain/InventoryLedgerService.ts` in full — study
      `deductStock()`/`transferStock()` (correct, atomic) side-by-side with `addStock()`/
      `adjustStock()` (broken, read-then-write) in the SAME file
- [ ] Read `packages/platform-sdk/src/locks.ts` in full — `withLock()` is correct (try/finally);
      `acquire()`'s fencing-token path is missing a try/finally (see Step 6 — you may fix this as
      part of adopting it, or note it as a prerequisite blocker if you adopt `acquire()` anywhere)
- [ ] Read `apps/sales-service/src/domain/ValuationService.ts`,
      `apps/purchase-service/src/domain/ValuationService.ts`,
      `apps/inventory-service/src/domain/ValuationService.ts` — three separate FIFO/WACC
      implementations, all with the same bug pattern
- [ ] Read `apps/sales-service/src/domain/PaymentService.ts` in full, specifically `allocate()`
      (lines ~80-115)
- [ ] Read `apps/sales-service/src/domain/SaleReturnService.ts` and
      `apps/purchase-service/src/domain/PurchaseReturnService.ts` side-by-side
- [ ] Read `apps/purchase-service/src/domain/GRNService.ts` (`create()`, lines ~73-102, and
      `approve()`, lines ~132-149)
- [ ] Read `apps/sales-service/src/api/invoice.routes.ts:52-54` and
      `InvoiceService.ts:240-246` (invoice number duplicate check)
- [ ] Read `apps/accounting-service/src/domain/FixedAssetService.ts:170-211`
      (`postMonthlyDepreciation`) and confirm `fixed_assets.version` exists in
      `packages/db-client/src/schema/accounting.ts:385`
- [ ] Run `pnpm test --filter @erp/sales-service --filter @erp/purchase-service --filter
      @erp/inventory-service --filter @erp/accounting-service` — confirm a clean baseline

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### The two acceptable fix patterns — pick per-case, don't mix arbitrarily

**Pattern A — atomic guarded UPDATE (preferred, cheaper, no lock contention):**
```sql
UPDATE inventory_fifo_layers
SET remaining_qty = remaining_qty - :consume
WHERE id = :id AND remaining_qty >= :consume
RETURNING remaining_qty;
-- if 0 rows returned, the layer didn't have enough remaining — throw InsufficientStockError
```
Use this whenever the operation is a single-row, single-column numeric adjustment with a clear
"don't go below X" invariant — this is what `items.availableQty` deduction already does correctly.

**Pattern B — `ctx.locks.withLock('resource:{id}', ttlMs, fn)` (for multi-step critical sections):**
```typescript
await ctx.locks.withLock(`item-valuation:${itemId}`, 5000, async () => {
  // read, compute, write — safe because no other request can enter this block for this itemId
});
```
Use this when the critical section spans multiple statements/tables that can't be collapsed into
one atomic UPDATE (e.g., WACC recompute touching both `items.waccCost` and
`items.currentStockValue` together).

`ctx.locks` is fully implemented in `packages/platform-sdk/src/locks.ts` but **currently has zero
callers anywhere in the app code** — you are the first phase to actually use it. Read it carefully
before adopting it.

### Coding Standards
- TypeScript strict — no `any`
- Every new atomic UPDATE must have a test that proves the race is closed (see Testing section) —
  a fix without a concurrency test doesn't count as done for this phase
- Don't touch `items.availableQty` deduction/`deductStock()`/`transferStock()` — they're already
  correct; changing them is out of scope and risks regression

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[C4]** Atomic/locked FIFO layer consumption and WACC cost updates (3 services)
2. **[C5]** Payment allocation: reject over-allocation, atomic balance update
3. **[H7]** Sale returns: validate against cumulative prior returns, not just original qty
4. **[H8]** Purchase returns: add the missing quantity validation entirely
5. **[H10]** Fix the lock-leak bug in `DistributedLockManager.acquire()`; adopt `ctx.locks` in the
   critical sections above where Pattern A doesn't fit
6. **[M1]** Close the GRN over-receipt TOCTOU gap
7. **[M2]** Make `InventoryLedgerService.addStock()`/`adjustStock()` atomic
8. **[M3]** Atomic/locked invoice-number duplicate check
9. **[M22]** Optimistic-lock `FixedAssetService.postMonthlyDepreciation`
10. **[L1]** Fix the same lost-update pattern in `ConsignmentService.recordSale()` before it gets a
    caller
11. **[L2]** Implement the stale TODO blocking item/warehouse deletion when ledger history exists

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — Fix `DistributedLockManager.acquire()` first [H10, prerequisite]

`packages/platform-sdk/src/locks.ts:48-64`: wrap the body in try/catch — if
`this.redis.incr(fenceKey)` (line ~55) or anything after the Redlock `lock()` call throws, release
the already-acquired lock before rethrowing. Add a unit test in `packages/platform-sdk`'s test
suite that simulates a Redis error mid-`acquire()` and asserts the lock is released (not leaked
until TTL).

### Step 2 — FIFO/WACC atomic updates [C4]

In all three `ValuationService.ts` files (sales, purchase, inventory-service):
- FIFO layer consumption (`consumeFifoLayers()`/equivalent): convert the read-then-write
  `remainingQty` update to Pattern A:
  `UPDATE inventory_fifo_layers SET remaining_qty = remaining_qty - :consume WHERE id = :id AND
  remaining_qty >= :consume RETURNING remaining_qty`. If a single sale/GRN consumes across multiple
  layers in sequence, wrap the whole multi-layer consumption loop in `ctx.locks.withLock('item-fifo:
  {itemId}:{warehouseId}', ...)` (Pattern B) so the layer-selection order itself can't race, in
  addition to each individual layer update being atomic.
- WACC cost update (`applyStockIn()`/equivalent, updating `items.waccCost` and
  `items.currentStockValue` together): this can't be a single atomic UPDATE since the new WACC
  value depends on reading the old value and quantity together — use Pattern B,
  `ctx.locks.withLock('item-valuation:{itemId}', 5000, fn)`, wrapping the read-compute-write.

Since there are 3 near-identical copies of this logic (per the audit's note on intentional
duplication to avoid cross-service calls — see project memory `architecture_no_cross_service_valuation`
if available to you), fix all 3 with the same approach so they don't drift further apart. Do not
attempt to consolidate them into a shared package in this phase — that's a larger refactor outside
this scope.

### Step 3 — Payment allocation [C5]

`apps/sales-service/src/domain/PaymentService.ts:80-115` (`allocate()`):
1. Add a per-allocation check: `alloc.amount <= invoice.balanceDue` for the specific invoice being
   allocated to — reject (throw a `ValidationError`/`BusinessError` with a clear message) if the
   allocation would exceed that invoice's remaining balance, rather than clamping with `Math.max(0,
   ...)`.
2. Make the balance decrement atomic: `UPDATE invoices SET balance_due = balance_due - :amt WHERE
   id = :id AND balance_due >= :amt RETURNING balance_due` — 0 rows returned means a concurrent
   allocation already consumed the balance; surface as a conflict error the caller can retry.
3. If the product intent is that overpayment should become a customer credit/advance rather than
   being rejected outright, check with existing domain vocabulary (`CreditNote`/advance-payment
   concepts already in the schema) before deciding — if no such concept exists yet, reject
   over-allocation rather than inventing a new advance-payment feature (out of scope for this
   phase).

### Step 4 — Sale/Purchase return quantity validation [H7, H8]

`apps/sales-service/src/domain/SaleReturnService.ts:74-76`: change the guard from comparing
`rl.returnQty` only against `origLine.quantity` to also summing all prior **approved**
`saleReturnLines.returnQty` for that `invoiceLineId` and validating
`rl.returnQty + alreadyReturned <= origLine.quantity`.

`apps/purchase-service/src/domain/PurchaseReturnService.ts:42-110` (`create()`): add the equivalent
check that currently doesn't exist at all — validate against `grnLines.receivedQty` minus any prior
approved purchase-return quantity on that line, mirroring the sales-side fix above.

### Step 5 — GRN over-receipt lock [M1]

`apps/purchase-service/src/domain/GRNService.ts:73-102` (`create()`): wrap the
read-remaining-qty-then-validate section in `ctx.locks.withLock('po-line:{poLineId}', 5000, fn)` so
two concurrent GRN creations against the same PO line can't jointly over-receive. The `approve()`
step's `+=` update (lines ~132-149) should also be covered by the same lock scope, or converted to
an atomic guarded UPDATE if it's a simple single-column increment with a ceiling check.

### Step 6 — Inventory ledger atomic add/adjust [M2]

`apps/inventory-service/src/domain/InventoryLedgerService.ts:30-65` (`addStock()`) and `:104-135`
(`adjustStock()`): convert both to the same atomic `UPDATE...WHERE...RETURNING` pattern already
used two functions away in `deductStock()`/`transferStock()`. For `adjustStock()`, the "don't go
negative" check (`if (after < 0) throw`) must be enforced by the WHERE clause
(`available_qty + :delta >= 0`), not by an app-level check against a value read before the write.

### Step 7 — Invoice number race [M3]

`apps/sales-service/src/api/invoice.routes.ts:52-54` / `InvoiceService.ts:240-246`: replace the
plain SELECT duplicate-check with either (a) relying on the DB's existing unique constraint and
catching the constraint-violation error to translate it into the intended 422
`INVOICE_NUMBER_DUPLICATE` response (cheapest fix, no lock needed), or (b) wrapping the check+insert
in `ctx.locks.withLock('invoice-number:{tenantId}:{number}', ...)`. Prefer (a) unless the team's
existing error-translation utilities make (b) simpler — check
`packages/shared-types/src/errors.ts` for an existing "translate Postgres unique-violation to
domain error" helper before writing a new one.

### Step 8 — Fixed asset depreciation optimistic lock [M22]

`apps/accounting-service/src/domain/FixedAssetService.ts:170-211`: add
`eq(fixedAssets.version, expectedVersion)` to the `currentValue` UPDATE's WHERE clause and increment
`version`, matching the pattern already correct in `apps/accounting-service/src/api/accounts.routes.ts`'s
PUT handler. On 0 rows affected, throw `OptimisticLockError`.

### Step 9 — Latent bug and stale TODO [L1, L2]

- `apps/production-service/src/domain/ConsignmentService.ts:104-122` (`recordSale()`): apply the
  same atomic-guard fix as Step 2/6 to `consignmentStocks.availableQty`/`soldQty`, even though this
  function has no caller yet — fix it now so it doesn't ship broken when it does get wired up.
- `apps/inventory-service/src/api/item.routes.ts:358` and `warehouse.routes.ts:185`: implement the
  `// TODO Phase 4: check inventory_ledger for stock, block if > 0` — query for any ledger rows
  referencing the item/warehouse and reject the delete (soft-delete) with a clear error if any
  exist.

### OUT OF SCOPE
- Consolidating the 3 duplicate ValuationService implementations into one shared package
- Building a customer-advance/credit feature for payment over-allocation (unless it already exists
  — see Step 3.3)
- Any change to `items.availableQty` deduction, `deductStock()`, `transferStock()` — already correct

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

Each fix needs a genuine concurrency test, not just a happy-path unit test — use whatever pattern
this codebase already uses for concurrency tests (check `apps/sales-service/src/__tests__/` for an
existing "N concurrent requests" test style, e.g. from ES-08's stock-deduction tests, and copy it):

1. **FIFO/WACC**: fire 2+ concurrent consume/stock-in calls against the same item/layer; assert the
   final `remainingQty`/`waccCost` reflects both operations correctly (not a lost update)
2. **Payment allocation**: fire 2 concurrent `allocate()` calls that together exceed
   `balanceDue`; assert exactly one succeeds fully and the other is rejected or correctly partial,
   with `balanceDue` never going negative and total allocated never exceeding the payment amount
3. **Sale return**: two sequential (not even concurrent — this bug doesn't need concurrency) return
   requests that together exceed the original quantity; assert the second is rejected
4. **Purchase return**: a return request exceeding GRN received qty is rejected
5. **GRN over-receipt**: 2 concurrent GRN creations against the same PO line that individually fit
   but jointly exceed ordered qty; assert the total received never exceeds ordered qty
6. **Inventory addStock/adjustStock**: concurrent calls against the same item; assert no lost update
7. **Invoice number**: 2 concurrent `confirm()` calls with the same number; assert exactly one
   succeeds and the other gets `INVOICE_NUMBER_DUPLICATE` (422), not a raw 500
8. **Fixed asset depreciation**: concurrent `postMonthlyDepreciation` calls for different periods on
   the same asset; assert no lost update to `currentValue`
9. **`DistributedLockManager.acquire()`**: simulated Redis failure after lock acquisition releases
   the lock (from Step 1)

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/sales-service build
pnpm --filter @erp/purchase-service build
pnpm --filter @erp/inventory-service build
pnpm --filter @erp/production-service build
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/sdk build
pnpm lint
pnpm type-check
pnpm test --filter @erp/sales-service --filter @erp/purchase-service --filter @erp/inventory-service --filter @erp/production-service --filter @erp/accounting-service --filter @erp/sdk
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] All 9 concurrency tests above pass and would have failed against the pre-fix code (verify
      this by temporarily reverting one fix and confirming its test fails — then re-apply)
- [ ] `ctx.locks.withLock` has at least one real caller for the first time in this codebase
- [ ] `DistributedLockManager.acquire()` releases its lock on a failure after acquisition
- [ ] No change to the already-correct `items.availableQty` atomic deduction paths

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Normal (non-concurrent) invoice creation, GRN approval, sale/purchase returns, payment
      allocation all still work end-to-end
- [ ] ES-13's FIFO/WACC valuation correctness (non-concurrent case) is unchanged
- [ ] ES-03's inventory ledger append-only guarantee is unaffected
- [ ] ES-09's GRNI matching logic still works for the normal partial-receipt/partial-invoice case
- [ ] Chaos-engineering scenarios in `ERP-PLANNING/phase-completions/chaos-engineering-report.md`
      (especially 1.1, saga compensation on inventory-service kill) still pass conceptually — rerun
      if you have the local stack available

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] C4, C5, H7, H8, H10, M1, M2, M3, M22, L1, L2 all closed per the fixes above
- [ ] All concurrency tests pass and are proven to catch the original bug
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-23_COMPLETION.md`
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` updated: mark C4, C5, H7, H8, H10, M1, M2, M3,
      M22, L1, L2 as ✅ FIXED with a pointer to the completion report

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-23_COMPLETION.md`

```markdown
# ES-23 Completion Report — Inventory & Financial Concurrency Hardening
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Pattern (A/B) | Verified By |
|---|---|---|---|
| C4 | FIFO/WACC lost-update race (3 services) | A + B | concurrency test |
| C5 | Payment over-allocation + race | A | concurrency test |
| H7 | Sale return exceeds original qty across multiple returns | validation | test |
| H8 | Purchase return no qty validation | validation | test |
| H10 | Lock leak in acquire() + zero adoption | try/catch fix + first real callers | unit test |
| M1 | GRN over-receipt TOCTOU | B | concurrency test |
| M2 | addStock/adjustStock non-atomic | A | concurrency test |
| M3 | Invoice number race | A/error-translation | concurrency test |
| M22 | Fixed asset depreciation no optimistic lock | A | concurrency test |
| L1 | ConsignmentService latent lost-update | A | unit test |
| L2 | Item/warehouse delete missing ledger check | validation | test |

## Locking Adoption
Where `ctx.locks.withLock` was newly adopted: [list resource-key naming used]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
[e.g. did payment over-allocation get rejected outright, or is there now a customer-advance path?]
```
