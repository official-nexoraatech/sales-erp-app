# 34 — Phase 2A Preflight (Implementation-Readiness Assessment)

Status: D1 **confirmed by user 2026-08-18** as option (B) — migrate `apps/sales-service` onto the shared `@erp/sdk` `ValuationService`, delete the local duplicate. This document is the independent, live-repository verification required before writing code, per the governing brief. Every claim below was checked by direct file read this session (not carried over from `24`–`33` without re-verification).

---

## 1. Correction to the plan — LoyaltyService.ts is NOT a caller

`26-decision-record.md`, `27-affected-flow-matrix.md` (#10), `30-revised-file-level-change-plan.md` (Step 2A.2), `32-revised-risk-register.md` (R8), and `33-revised-executive-summary.md` all state `apps/sales-service/src/domain/LoyaltyService.ts` is a "third caller" of the local `ValuationService`, found during the planning session's re-verification.

**This is false.** Direct read of `LoyaltyService.ts` (663 lines, full file) confirms:

- Zero `import` of `./ValuationService.js` or `@erp/sdk`'s `ValuationService`.
- The only occurrence of the string "ValuationService" is a code comment at line 58 drawing an analogy between `earnPoints()`'s `SELECT ... FOR UPDATE` locking pattern and "the same class of bug as ValuationService's stock-deduction race" — a comment referencing the class by name for context, not a call.
- `LoyaltyService`'s stock-adjacent logic is entirely about `customers.loyaltyPoints` / `loyalty_transactions`, not `inventory_fifo_layers` / `items.currentStockValue`. It never touches inventory valuation.

`grep -rn "ValuationService" apps/sales-service/src` confirms exactly two real callers (import + call site), not three:

```
apps/sales-service/src/domain/InvoiceService.ts:32   import { ValuationService } from './ValuationService.js';
apps/sales-service/src/domain/InvoiceService.ts:623  ValuationService.consumeForStockOut(trx, {...})   [confirm() stock-out]
apps/sales-service/src/domain/InvoiceService.ts:902  ValuationService.applyStockIn(trx, {...})         [cancel() reversal]
apps/sales-service/src/domain/SaleReturnService.ts:18  import { ValuationService } from './ValuationService.js';
apps/sales-service/src/domain/SaleReturnService.ts:233 ValuationService.applyStockIn(trx, {...})        [create() restock]
```

**Effect on scope**: Phase 2A's Step 2A.2 file list shrinks by one file (no `LoyaltyService.ts` edit). R8 in the risk register is moot — there is no fourth/third divergent call site to miss, because it never existed. No other conclusion in `25`–`33` depends on this error; D1's recommendation (B) stands on its own merits independent of caller count.

---

## 2. Line-by-line engine diff (Step 2A.1)

Full read of both files this session: `apps/sales-service/src/domain/ValuationService.ts` (287 lines) vs. `packages/platform-sdk/src/valuation-engine.ts` (416 lines).

| Aspect                                                                           | Local (sales-service)                                                                      | Shared (`@erp/sdk`)                                                                                                                                              | Divergence?                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `applyStockIn` — WACC recompute formula                                          | `Math.round((newTotalValue/newTotalQty)*100)/100`                                          | Identical                                                                                                                                                        | None                                                                                                                                |
| `applyStockIn` — FIFO layer insert                                               | No `batchNumber`/`expiryDate` keys                                                         | Adds `batchNumber: params.batchNumber, expiryDate: params.expiryDate` (optional, same `undefined`-omission idiom already used for `variantId` in the local file) | Additive only                                                                                                                       |
| `consumeForStockOut` — item select                                               | `{costingMethod, waccCost, currentStockValue}`                                             | Adds `fefoEnabled: items.fefoEnabled` to the select                                                                                                              | Additive only                                                                                                                       |
| `consumeForStockOut` — WACC branch, warehouse WACC deduction                     | Identical formula, identical helper structure                                              | Identical                                                                                                                                                        | None                                                                                                                                |
| `consumeFifoLayers` — layer query                                                | `orderBy(asc(receivedAt))`, unconditional                                                  | `orderBy(fefoEnabled ? expiryDate-NULLS-last-then-receivedAt : asc(receivedAt))`, `fefoEnabled` defaults `false`                                                 | **The intended fix** — behaviorally identical when `fefoEnabled` is falsy/undefined/null (the only state reachable before Phase 2B) |
| `consumeFifoLayers` — consumption loop, rounding, insufficient-stock check       | `Math.round(totalCogs*100)/100`, `StockInsufficientForCostingError` at `>0.0001` threshold | Identical                                                                                                                                                        | None                                                                                                                                |
| Row locking (`FOR UPDATE`) discipline                                            | `items` row locked first, then all candidate layers                                        | Identical lock order and scope                                                                                                                                   | None                                                                                                                                |
| `applyLandedCostAdjustment`                                                      | **Does not exist**                                                                         | Exists (purchase-service's landed-cost allocation)                                                                                                               | Additive-only; sales-service has no landed-cost flow and will not call it — dead code from sales-service's perspective, harmless    |
| Extra `@erp/db` import                                                           | —                                                                                          | `inventoryLedger` (used only by `applyLandedCostAdjustment`)                                                                                                     | No conflict — sales-service already imports `inventoryLedger` elsewhere                                                             |
| Error types, params shapes (`StockOutValuationParams`, `StockInValuationParams`) | Subset of shared engine's fields                                                           | Superset (two extra optional fields)                                                                                                                             | Strictly additive — every existing call site's params object is still valid against the shared engine's wider interface             |

**Conclusion**: no undocumented behavioral divergence found beyond the two already identified in the plan (FEFO ordering, batch/expiry field support) plus one previously-undocumented addition (`applyLandedCostAdjustment`, irrelevant to sales-service). Confirms acceptance criterion 2A-1.

---

## 3. Dependency and API compatibility

- `apps/sales-service/package.json` already lists `"@erp/sdk": "workspace:*"` — no new dependency to add.
- `packages/platform-sdk/package.json` resolves via `exports./.import` to `./dist/index.js` (build-output only, no source-path alias) — **`@erp/sdk` must be built for the migration to compile/run**, including under `vitest` (sales-service has no `vitest.config.ts` override, so module resolution goes through the package's `exports` field, not a source alias). Verified: `packages/platform-sdk/dist/valuation-engine.js` exists, is newer than its `.ts` source, and already contains 4 references to `fefoEnabled` — **already built and current**, no rebuild required to pick up FEFO support. (Will still run `pnpm --filter @erp/sdk build` before testing as a defensive step, since it's cheap and removes any doubt.)
- `packages/platform-sdk/src/index.ts:35` already exports `ValuationService` from `./valuation-engine.js` — the public API surface sales-service needs is already exposed, no `@erp/sdk` change required.
- Both `StockOutValuationParams`/`StockInValuationParams` call shapes at the two real call sites (`InvoiceService.ts:623/902`, `SaleReturnService.ts:233`) pass only fields present in both interfaces — confirmed by direct read, no call site needs to change beyond the import line.

## 4. Transaction semantics

Identical in both engines: every method takes `db`/`trx` as its first argument and performs no `db.transaction()` of its own — it relies entirely on the caller's transaction boundary. `InvoiceService.confirmInTransaction()` and `.cancel()`, and `SaleReturnService.create()`, all already wrap their `ValuationService` calls inside an outer `trx`. Migrating the import changes nothing about transaction scope, isolation, or commit/rollback behavior.

## 5. Concurrency behavior

Row-locking order and scope (`FOR UPDATE` on `items`, then on all candidate `inventory_fifo_layers` rows for FIFO items, held for the transaction's life) is byte-identical between the two engines. No new concurrency risk introduced; sales-service inherits the same double-allocation protection already proven under concurrent load in `inventory-service`/`purchase-service`/`production-service`.

## 6. Error behavior

`StockInsufficientForCostingError` (from `@erp/types`) is thrown identically (same threshold, same constructor args) in both engines. `InsufficientStockError` (sales-service's own, thrown earlier in `InvoiceService.confirmInTransaction` before `ValuationService` is even called, on the atomic `availableQty` UPDATE) is unrelated to this migration and unaffected.

## 7. COGS / accounting-integration behavior

Confirmed by direct read of `InvoiceService.ts:623-631/811`: `cogsPerUnit`/`invoiceCogsTotal` are computed from `ValuationService.consumeForStockOut`'s return value exactly as before — the migration changes only which module supplies that number, not how it's used or emitted (`COGS_CALCULATED` event, `accounting-service`'s `CogsAccountingConsumer.ts`, unchanged, not touched this phase per `28-financial-impact-analysis.md` §10, independently re-confirmed not to need modification).

## 8. Test-mock compatibility (the concrete risk that determines whether 2A-2 is achievable)

Two sales-service test files exercise real `ValuationService` logic against a mocked `@erp/db`/drizzle-orm module boundary (not a mocked `ValuationService` — no test file mocks it directly, confirmed by `grep`):

- **`invoice-ledger.test.ts`**: uses a strict **positional script** (`makeTrx`) — each `await` in `InvoiceService.confirm()` consumes the next scripted value in call order, regardless of what columns were requested in the `.select({...})` call shape. The shared engine's extra `fefoEnabled: items.fefoEnabled` select-column and extra `batchNumber`/`expiryDate` insert-keys do not add or remove an `await`, so the call-count/order this test depends on is unchanged. Verified line-by-line against the script comments (e.g. `// ES-13: ValuationService item lookup` maps 1:1 to the single `consumeForStockOut` select).
- **`sales-workflow.test.ts`** (`InvoiceService.cancel`, `SaleReturnService.create`): uses a more resilient **catch-all `mockImplementation`** for `where()`-terminated calls after the first few positional ones — explicitly comments that it tolerates "the new `ValuationService.applyStockIn` item lookup and reversal cogsPerUnit lookup" without depending on exact valuation math. Lower risk than the positional style.
- `@erp/db` is mocked once per test file at the top (`vi.mock('@erp/db', () => ({...}))`) and already includes every table both engines touch (`items`, `inventoryFifoLayers`, `inventoryWarehouseValuation`, `inventoryLedger`) — the shared engine's nested import of `@erp/db` resolves through the same test-file-scoped mock, since `vi.mock` intercepts the specifier transitively across the whole module graph loaded by that test file. No new table needs adding to any mock.
- No test file imports `apps/sales-service/src/domain/ValuationService.ts` directly (`grep` confirmed zero matches) — it is only ever exercised indirectly through `InvoiceService`/`SaleReturnService`, so deleting it has no direct-import fallout to chase.
- `invoice-validation.test.ts` does not reference `ValuationService` at all (pure validation-layer tests) — unaffected either way.

**Conclusion**: existing tests are structurally compatible with the migration with zero assertion changes expected, matching acceptance criterion 2A-2's requirement.

## 9. Test-coverage gaps (pre-existing, confirmed)

- **No dedicated `SaleReturnService`-only test file exists.** Its only real logic coverage is inside `sales-workflow.test.ts`'s `describe('SaleReturnService.create', ...)` block (confirmed) — the plan's `31-revised-acceptance-criteria.md` already anticipates this by specifying a new `sale-return-batch-traceability.test.ts`.
- **No FEFO-ordering test exists anywhere in sales-service** today (confirmed, `grep` for `fefoEnabled`/`FEFO` in `apps/sales-service/src` returns zero matches outside this planning doc set) — consistent with `27-affected-flow-matrix.md` #8/#9's claim.
- Both gaps are already scoped as new test files in `30-revised-file-level-change-plan.md` Steps 2A.3/2A.4 and are addressed in the implementation below.

## 10. Readiness verdict

**Safe to proceed with Phase 2A as scoped**, with one scope correction (§1 above — one fewer file to touch than the plan states). No repository evidence contradicts D1(B)'s recommendation; if anything, the corrected caller count makes the migration strictly smaller and lower-risk than `26`–`33` estimated. No blocking gap found in dependency, transaction, concurrency, error, COGS, or test-mock compatibility.

Proceeding to `35-sales-valuation-compatibility-matrix.md`, then implementation.
