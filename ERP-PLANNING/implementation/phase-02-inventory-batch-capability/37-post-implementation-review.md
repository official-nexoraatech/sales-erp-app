# 37 — Post-Implementation Review: Phase 2A (Sales Valuation Engine Consolidation)

**Reviewer stance**: independent audit. No source, migration, config, or test file was modified during this review. All claims below were checked against live source, or by running typecheck/tests myself in this session — not taken from `36-implementation-report.md` on trust. Where I could not independently execute something (real-DB integration tests), that is stated explicitly, not inferred as passing.

---

## 1. Executive Summary

Phase 2A did exactly what `26-decision-record.md` D1(B) authorized: migrate `apps/sales-service` off its stale local `ValuationService.ts` onto the shared `@erp/sdk` `valuation-engine.ts`, and delete the local duplicate. The diff is minimal and surgical — two one-line import changes (`InvoiceService.ts`, `SaleReturnService.ts`), one file deletion (287 lines), two new DB-gated integration test files, and two new planning documents. I independently re-ran the exact regression suite the implementation report claims (`invoice-ledger.test.ts`, `invoice-validation.test.ts`, `sales-workflow.test.ts`, `pos-completion.test.ts`) and got the identical result (48 passed, 6 pre-existing skips). Typecheck for both `sales-service` and `@erp/sdk` passes with zero errors, confirmed by me running `tsc --noEmit` directly. The two new FEFO/traceability integration tests are real, correctly written, and correctly gated on `DATABASE_URL` — they collect cleanly but are **skipped** in this environment (no reachable Postgres/Docker), exactly as the implementation report discloses. They are **written but not runtime-verified**, not passing.

The one notable observation outside Phase 2A's own diff: the working tree also contains a large amount of **unrelated, uncommitted Phase 1 "Capability Foundation" work** (`capability-guard.ts`, `capability-registry.ts`, auth/tenant/web-frontend changes). This is not part of Phase 2A, is not mentioned in `36-implementation-report.md`'s file list, and does not touch valuation — but it means the current working tree is not a clean Phase-2A-only diff, which matters for anyone about to commit.

**No BLOCKER or HIGH finding.** The gaps that exist (2A-3/2A-4 not runtime-proven) were already disclosed by the implementation report itself, and are exactly the two things it recommends this review chase before Phase 2B.

---

## 2. Scope Verification

Confirmed by direct `git diff --stat` and file-by-file read: Phase 2A's actual changes are limited to:

- `apps/sales-service/src/domain/InvoiceService.ts` — 1 import line moved (`./ValuationService.js` → added to existing `@erp/sdk` import block)
- `apps/sales-service/src/domain/SaleReturnService.ts` — 1 import line changed (`./ValuationService.js` → `@erp/sdk`)
- `apps/sales-service/src/domain/ValuationService.ts` — deleted (287 lines)
- `apps/sales-service/src/__tests__/valuation-fefo.test.ts` — new, DB-gated
- `apps/sales-service/src/__tests__/sale-return-batch-traceability.test.ts` — new, DB-gated
- `34-phase-2a-preflight.md`, `35-sales-valuation-compatibility-matrix.md` — new planning docs

No capability-gating code, no `fefoEnabled` write path, no expiry-blocking logic, and no accounting-service change exist anywhere in this diff. Grepped `apps/inventory-service/src/api` and `apps/inventory-service/src/routes` for `fefoEnabled` — zero matches — confirming no item-level write path was added (Phase 2B territory untouched).

**Scope creep from Phase 2A itself: none found.**

**Adjacent but unrelated finding**: the working tree also has uncommitted Phase 1 Capability Foundation work — `packages/platform-sdk/src/capability-guard.ts`, `packages/shared-types/src/capability-registry.ts` (registry has exactly 2 entries, `HR_PAYROLL`/`POS` — no `INVENTORY_BATCH`, confirming Phase 2B has not silently started), plus diffs in `apps/auth-service/src/routes/users.ts`, `apps/tenant-service/src/domain/BillingService.ts`, `packages/logger/src/erp-metrics.ts`, `packages/shared-types/src/index.ts`, and several `web-frontend` files. I read the actual diffs: they reference `ERP-PLANNING/implementation/phase-01-capability-foundation/` in code comments and add `requireCapability`/`isCapabilityEnabled`/metrics for a generic capability guard — this is Phase 1 infrastructure, not Phase 2. It is **not mentioned anywhere in `36-implementation-report.md`**, meaning it predates or is concurrent with, but not produced by, the Phase 2A session. See §14 for the git-state implication.

---

## 3. Source-Code Evidence — Valuation Engine Migration

Direct reads, this session:

```
apps/sales-service/src/domain/InvoiceService.ts:28    ValuationService  (added to @erp/sdk import block)
apps/sales-service/src/domain/InvoiceService.ts:623   ValuationService.consumeForStockOut(trx, {...})
apps/sales-service/src/domain/InvoiceService.ts:902   ValuationService.applyStockIn(trx, {...})
apps/sales-service/src/domain/SaleReturnService.ts:18  import { ValuationService } from '@erp/sdk';
apps/sales-service/src/domain/SaleReturnService.ts:233 ValuationService.applyStockIn(trx, {...})
```

`packages/platform-sdk/src/index.ts:36` exports `ValuationService` from `./valuation-engine.js` — the import resolves to the intended shared implementation, not a stray re-export.

`git diff apps/sales-service/src/domain/InvoiceService.ts apps/sales-service/src/domain/SaleReturnService.ts` shows **exactly** two lines changed per file — no other line touched. Matches the report's claim precisely.

`test -f apps/sales-service/src/domain/ValuationService.ts` → file does not exist (deleted, confirmed on disk, not just in git status).

`grep -rn "ValuationService.js" apps/sales-service/src` → zero matches (exit code 1). **No remaining production callers of the deleted local engine.**

Repo-wide `grep` for `ValuationService` found 8 real call sites across `sales-service`, `inventory-service` (`InventoryLedgerService.ts`), `purchase-service` (`GRNService.ts`, `PurchaseReturnService.ts`, `LandedCostService.ts`), `production-service` (`JobWorkOrderService.ts`) — all importing from `@erp/sdk`, none from a local duplicate anymore.

**LoyaltyService.ts** — grepped directly: the only hit is a code comment at line 58 (`// same class of bug as ValuationService's stock-deduction race...`). Zero imports, zero calls. This independently reconfirms `34-phase-2a-preflight.md` §1's correction of the original plan's false "third caller" claim — see §8 below for the full trace of how that error propagated and was caught.

---

## 4. Valuation-Engine Migration Verification

`packages/platform-sdk/src/valuation-engine.ts` read in full (416 lines). Confirmed directly:

- `consumeFifoLayers` (lines 339–415) takes `fefoEnabled = false` as a parameter with that exact default, and branches the `orderBy` clause: `fefoEnabled ? (expiryDate IS NULL, expiryDate ASC, receivedAt ASC) : asc(receivedAt)`. When `fefoEnabled` is falsy (the only reachable state today), behavior is byte-identical to plain FIFO.
- `consumeForStockOut` (lines 116–167) selects `items.fefoEnabled` and passes it through to `consumeFifoLayers` — this is the actual wiring that makes FEFO reachable, not just present in the file.
- `applyStockIn` (lines 55–111) accepts optional `batchNumber`/`expiryDate` and threads them onto new FIFO layer inserts (line 94–95) when supplied.
- Row-locking: `items` is locked `FOR UPDATE` first (line 66–70, `consumeForStockOut`'s equivalent at 124–133), then all candidate `inventory_fifo_layers` rows (line 371) — identical order/scope described in the planning docs.

This matches `34-phase-2a-preflight.md` §2's line-by-line diff claims exactly — I did not find any undocumented divergence beyond what the preflight already catalogued (FEFO ordering, batch/expiry fields, and the sales-service-irrelevant `applyLandedCostAdjustment` method).

---

## 5. Behavioral Compatibility

Cross-checked `35-sales-valuation-compatibility-matrix.md`'s 14 scenarios against the actual code:

- **FIFO/FEFO ordering** (#1–#3): confirmed in the engine source (§4 above) — `fefoEnabled` falsy → identical to pre-migration FIFO-only behavior.
- **Cost calculation / rounding** (#11): `InvoiceService.ts:623-631` — `lineCogs` from `consumeForStockOut`, `cogsPerUnit = round(lineCogs/lineQty, 2)`, `invoiceCogsTotal` accumulated — read directly, matches the matrix's claim, unchanged by the migration (only the import source changed).
- **Insufficient stock** (#6): confirmed `StockInsufficientForCostingError` thrown identically in the shared engine at the same `>0.0001` threshold. Also confirmed (`InvoiceService.ts:594-619`) that most insufficient-stock cases are rejected earlier by an atomic `UPDATE ... WHERE availableQty >= lineQty` guard before `ValuationService` is ever reached — this guard is unrelated to the migration and unchanged.
- **Invoice-cancel reversal** (#14): read `InvoiceService.ts:860-911` directly — reversal reads the **original** STOCK_OUT's recorded `cogsPerUnit` from `inventory_ledger` and replays it via `applyStockIn`; it does not call `consumeForStockOut` or re-derive cost. Confirmed unaffected by ordering, matches the matrix.
- **Sales return restock** (#8): see §7 below.

**Zero scenario found where the matrix's "PHASE 2A BEHAVIOR" claim conflicts with what the code actually does.**

---

## 6. FEFO Verification

Traced the real call path directly:

```
InvoiceService.confirmInTransaction()  [InvoiceService.ts:623]
  → ValuationService.consumeForStockOut(trx, {...})     [@erp/sdk, valuation-engine.ts:116]
    → selects items.fefoEnabled                          [:129]
    → ValuationService.consumeFifoLayers(..., item.fefoEnabled)  [:137-144]
      → orderBy(fefoEnabled ? FEFO-order : FIFO-order)    [:366-370]
  → lineCogs returned, cogsPerUnit computed               [InvoiceService.ts:630-631]
  → invoiceCogsTotal aggregated, COGS_CALCULATED emitted  [:811]
```

This is a real, direct, unmocked call chain — not an assumption. **FEFO ordering is now structurally reachable from `InvoiceService.confirm()`**, which was not true before this migration (the local engine's `consumeFifoLayers` had no `fefoEnabled` parameter at all).

However: it is **not reachable in production today**, because `items.fefoEnabled` has no write path anywhere in the codebase (confirmed: zero matches for `fefoEnabled` in `inventory-service`'s API/routes layer). This is correct and intentional — Phase 2B, not 2A, adds the write path.

The new `valuation-fefo.test.ts` exercises this exact call path end-to-end (real `InvoiceService.confirm()`, real DB, two layers with different expiry/cost) and asserts the correct layer is consumed. I confirmed the test **collects and type-checks cleanly** under vitest but is **skipped** (`describe.skipIf(!DB_URL)`, and `DATABASE_URL` is unset, Docker daemon unreachable in this sandbox — I verified both independently). **Do not read "reachable in code" as "proven at runtime" — it is not, in this environment, in this session.**

---

## 7. Sales-Return Verification

Traced `SaleReturnService.create()` completely. Read `SaleReturnService.ts:207-260` directly:

- Writes a `STOCK_IN` `inventory_ledger` row for the restored quantity.
- Calls `ValuationService.applyStockIn(trx, {...})` at line 233 with `tenantId, itemId, variantId, warehouseId, quantity, unitCost: r.reversalUnitCost, qtyBeforeStockIn, sourceLedgerId` — **no `batchNumber`, no `expiryDate`** in the call-site object literal. Confirmed by direct read, not inference.
- Cost basis (`reversalUnitCost`) is preserved correctly — it comes from the original sale's recorded cost, not re-derived.
- Batch/expiry traceability is genuinely lost: the new FIFO layer this creates will have `batchNumber: undefined`/`expiryDate: undefined` regardless of the item's `fefoEnabled` state, because the shared engine only writes what the caller passes, and the caller passes nothing for those two fields.

**Independent determination on the traceability gap**: **pre-existing, not introduced by Phase 2A.** The local (now-deleted) engine's `StockInValuationParams` interface never had `batchNumber`/`expiryDate` fields at all — the gap existed before this migration too, just without even the _capability_ to close it. Phase 2A does not fix it (out of scope, explicitly named as such) and does not make it worse — the shared engine now _supports_ carrying those fields through if some future call site chooses to pass them; today's call site still doesn't. This matches `27-affected-flow-matrix.md` #10 and the implementation report's own characterization. **Correctly deferred, not silently dropped** — pinned by the new `sale-return-batch-traceability.test.ts`, which explicitly asserts `restockedLayer.batchNumber` and `.expiryDate` are `null` (i.e., it pins the gap, not a fix). This test is also DB-gated and currently skipped — same caveat as §6.

---

## 8. LoyaltyService Claim — Independent Verification

Read `apps/sales-service/src/domain/LoyaltyService.ts` in full. Result, independently confirmed (not copied from the planning docs):

- Zero `import` statements referencing `ValuationService`, `./ValuationService.js`, or `@erp/sdk`'s `ValuationService`.
- The only textual occurrence of "ValuationService" anywhere in the file is a comment at line 58, drawing an analogy between a locking pattern in `earnPoints()` and "the same class of bug as ValuationService's stock-deduction race" — this is a comment referencing the class name for context, not an instantiation or call.
- `LoyaltyService`'s logic operates on `customers.loyaltyPoints`/`loyalty_transactions` — no reference to `inventory_fifo_layers`, `items.currentStockValue`, or any stock-valuation table.

**Factual result: LoyaltyService never imported, instantiated, or called `ValuationService`, in the current codebase or, per the direct-read evidence chain in `34-phase-2a-preflight.md` §1, at any point this session's planning docs checked.** The original plan's claim of a "third caller" was false, correctly caught and corrected before implementation, and I found nothing in the current source that reopens the question.

---

## 9. Test Verification

**Tests added**: `valuation-fefo.test.ts` (2 tests), `sale-return-batch-traceability.test.ts` (1 test) — both new, both real integration tests against actual Postgres tables (unmocked `@erp/db`), both gated `describe.skipIf(!DB_URL)`.

**Existing tests covering the migration** (re-run by me independently, not trusted from the report):

| File                         | My result                                     |
| ---------------------------- | --------------------------------------------- |
| `invoice-ledger.test.ts`     | 3 passed                                      |
| `invoice-validation.test.ts` | 10 passed                                     |
| `sales-workflow.test.ts`     | 34 passed                                     |
| `pos-completion.test.ts`     | 1 passed, 6 skipped (pre-existing, unrelated) |

Command run: `npx vitest run src/__tests__/invoice-ledger.test.ts src/__tests__/invoice-validation.test.ts src/__tests__/sales-workflow.test.ts src/__tests__/pos-completion.test.ts` from `apps/sales-service`. **Result: 48 passed, 6 skipped — matches the implementation report's claim exactly, independently reproduced.**

**Tests actually executed vs. skipped**: the two new tests were skipped by me too, for the same reason the report gives — `DATABASE_URL` unset, `docker ps` fails with "failed to connect to the docker API... The system cannot find the file specified." I confirmed this directly rather than trusting the report's claim of "no Docker daemon."

**Why skipped, and is that legitimate**: yes. These are integration tests asserting real `ORDER BY`/insert behavior against Postgres-specific SQL (`sql` template literals in the `orderBy` clause) — a mocked `drizzle-orm`/`@erp/db` boundary cannot prove that SQL actually executes as written; only a real database can. This is the same convention already used by `packages/platform-sdk/src/__tests__/valuation-engine-fefo.test.ts`, which I also ran — also skipped, same reason, confirming this isn't a new pattern invented to dodge testing.

**Explicitly, per the audit brief's instruction: `valuation-fefo.test.ts` and `sale-return-batch-traceability.test.ts` are WRITTEN BUT NOT RUNTIME-VERIFIED. Not PASS.**

---

## 10. Database Integration Status

Neither `valuation-fefo.test.ts` nor `sale-return-batch-traceability.test.ts` has ever been executed against a real PostgreSQL database, in this session or (per the implementation report, which I have no reason to doubt on this specific point since the sandbox constraint is externally verifiable and I reproduced it myself) in the implementation session either. **Status: WRITTEN BUT NOT RUNTIME-VERIFIED for both.**

Notably, this same status applies to `packages/platform-sdk/src/__tests__/valuation-engine-fefo.test.ts` — the engine-level FEFO test that `26-decision-record.md` cites as evidence the ordering logic is "already correct, already tested." I ran it myself: also skipped, also no DB. The planning docs' confidence in the engine's FEFO correctness rests on that test's _existence and design_, not on an executed run I can personally confirm in this environment. This is a pre-existing condition (not something Phase 2A introduced — the engine and its test predate this phase), but it means the FEFO ordering logic itself — not just the new sales-service integration — has not been runtime-proven in this environment at any layer.

---

## 11. Regression Status

Ran the other three consumers' valuation-related test suites myself, independently:

| Service              | Files                                                                   | Result                                   |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `inventory-service`  | `valuation.test.ts`, `ledger-service.test.ts`, `valuation-line.test.ts` | 22 passed                                |
| `purchase-service`   | `purchase-workflow.test.ts`, `purchase-return-ledger.test.ts`           | 25 passed                                |
| `production-service` | `job-work-order-valuation.integration.test.ts`                          | 2 skipped (DB-gated, same reason as §10) |

**No regression found in any of sales-service's sibling consumers of the shared engine** — expected, since the shared engine's source was not modified by Phase 2A at all (`git diff --stat` confirms zero changes under `packages/platform-sdk/src/`).

**Full sales-service suite JWT-issuer failures** — spot-checked two of the report's claimed 12 failing files directly (`permission-guards.test.ts`, `pos-branch-isolation.test.ts`): both fail with the exact `expected 401 to be 403` / `expected 401 to be 202` signature the report describes. Grepped for the hardcoded issuer: `permission-guards.test.ts:38` has `const TEST_ISSUER = 'erp-test';`, and a repo-wide grep found **19** sales-service test files hardcoding `'erp-test'` (a superset of the report's 12 — some of those 19 evidently pass anyway or are the pre-existing skipped integration tests, not a contradiction). Grepped both spot-checked files for any reference to `ValuationService`/`InvoiceService`/`SaleReturnService`: **zero matches** — these are pure auth/permission-guard tests with no dependency on the migrated code. **Independently confirmed: pre-existing, unrelated to Phase 2A**, consistent with session memory (`preexisting_jwt_issuer_test_bug.md`, dated 2026-07-30, predating this phase by weeks).

**Typecheck**: `apps/sales-service` → `npx tsc --noEmit`, exit code 0, run by me directly. `packages/platform-sdk` → same command, same result, exit code 0.

---

## 12. Accounting Impact

Read `apps/accounting-service/src/consumers/CogsAccountingConsumer.ts` in full (55 lines), independently, not from the planning docs' summary:

```ts
const cogsTotal = Number(p.cogsTotal ?? 0);
...
const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
  eventType: 'COGS_CALCULATED', amount: cogsTotal, ...
});
```

**Confirmed independently**: this consumer performs zero recomputation and has no import or awareness of `ValuationService`, FIFO, FEFO, or any engine internals. It trusts whatever `cogsTotal` number arrives on the event. `git diff --stat` confirms zero files under `apps/accounting-service/` changed.

**On "financially neutral" — do not accept that label unverified.** `28-financial-impact-analysis.md` itself already corrects the _original_ plan's false neutrality claim: FEFO layer selection **does** change which unit-cost layer is consumed first, which **does** change COGS whenever layers have different unit costs (the normal case). This is a real, direct, and intended future financial-behavior change once FEFO is actually activated. **What is true today, and what I independently confirmed**: Phase 2A itself carries zero financial-behavior change for any existing tenant, **not because ordering doesn't matter, but because no item can be `fefoEnabled: true` yet** (no write path exists — confirmed §6). The neutrality is a fact about the current unreachable state of the flag, not a property of the ordering logic itself. Once Phase 2B ships a write path, this claim stops being true the moment any tenant flips the flag — and the financial-impact-analysis document says so explicitly. I found no evidence that Phase 2A itself changed this conclusion in either direction.

---

## 13. Concurrency Assessment

Read the shared engine's locking discipline directly (`valuation-engine.ts:66-70`, `:124-133`, `:355-371`): `items` row is locked `FOR UPDATE` first in both `applyStockIn` and `consumeForStockOut`, then (for FIFO/FEFO items) all candidate `inventory_fifo_layers` rows are locked `FOR UPDATE` before any read-modify-write on `remainingQty`. This lock is held for the life of the enclosing transaction.

`InvoiceService.ts` and `SaleReturnService.ts` both call these methods with a `trx` handle inherited from the caller's own `db.transaction()`/`trx` wrapper — neither `applyStockIn` nor `consumeForStockOut` opens its own transaction. Confirmed by direct read: the migration only changed the import source, not the call-site's transaction-boundary usage.

**No new concurrency risk found.** Sales-service now shares the exact same locking code (not a re-implementation) already exercised by `inventory-service`/`purchase-service`/`production-service` under their own concurrent-write paths — it inherits their proof rather than needing a new one. No double-allocation, no race, no transaction-boundary change identified.

---

## 14. Git/Worktree Assessment

`git diff --stat` (18 files, 131 insertions, 303 deletions) contains **two clearly separable groups**:

**Group A — Phase 2A (this review's subject)**: `InvoiceService.ts` (2 lines), `SaleReturnService.ts` (2 lines), `ValuationService.ts` (deleted, 287 lines), plus untracked `valuation-fefo.test.ts`, `sale-return-batch-traceability.test.ts`, and the two new planning docs (`34`, `35`, and this `37`).

**Group B — unrelated, uncommitted Phase 1 Capability Foundation work**: `apps/auth-service/src/routes/users.ts`, `apps/tenant-service/src/domain/BillingService.ts`, `apps/web-frontend/src/{api/endpoints.ts, components/Layout.tsx, components/erp/ERPCommandPalette.tsx, lib/navigation.ts, store/auth.store.ts}` and their tests, `packages/logger/src/{erp-metrics.ts, index.ts}`, `packages/platform-sdk/{package.json, src/index.ts}` (the `requireCapability`/`isCapabilityEnabled` export — this is a real diff to a file Phase 2A also touched conceptually, but the actual added lines are unrelated to `ValuationService`), `packages/shared-types/src/index.ts`, plus untracked `capability-guard.ts`, `capability-registry.ts`, and their tests. None of this references `ValuationService`, `InvoiceService`, or `SaleReturnService`. `CAPABILITY_REGISTRY` has exactly 2 entries (`HR_PAYROLL`, `POS`) — confirming Phase 2B's `INVENTORY_BATCH` entry has not been silently added.

Also present: `.qa-tmp-index-list.txt`, `apps/web-frontend/.qa-scratch/`, `ERP-PLANNING/multi-industry-platform/` — unrelated scratch/planning artifacts, not source.

**Determination: Phase 2A's changes are cleanly separable from Group B** by file path alone — a `git add` of exactly the 5 Phase-2A files listed above would produce a clean, isolated commit. But the working tree as it stands today is **not** that clean commit — anyone running `git add -A` right now would bundle unrelated Phase 1 work into whatever they commit. This is not a Phase 2A defect, but it is a real operational risk worth flagging before anyone commits.

**No commit was made. No destructive git operation was run.**

---

## 15. Acceptance Criteria (`31-revised-acceptance-criteria.md`)

| #    | Criterion                                             | Verdict     | Basis                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2A-1 | Engine differences fully catalogued                   | **PASS**    | `34-phase-2a-preflight.md` §2 verified against direct source read; no undocumented divergence found beyond what's listed                                                                                                                                       |
| 2A-2 | Byte-identical behavior for `fefoEnabled=false`       | **PASS**    | Independently re-ran all 4 target test files: 48 passed, 6 pre-existing skips, zero assertion changes                                                                                                                                                          |
| 2A-3 | FEFO ordering works through the real call path        | **PARTIAL** | Code path verified correct by direct read (§6); test exists, collects, is well-designed — but has never executed against a real DB, so the acceptance criterion's literal check ("`valuation-fefo.test.ts` passes") is **not met** — it's skipped, not passing |
| 2A-4 | Sales-return restock preserves/documents traceability | **PARTIAL** | Same reasoning as 2A-3 — the gap is correctly identified and pinned in a well-written test, but that test has not run                                                                                                                                          |
| 2A-5 | Zero behavior change for any tenant on merge          | **PASS**    | Confirmed by construction (§6, §12) — no write path for `fefoEnabled` exists anywhere; regression suite (independently re-run) shows no diff                                                                                                                   |
| 2A-6 | Local duplicate fully removed                         | **PASS**    | File confirmed deleted on disk; `grep -rn "ValuationService.js"` returns zero matches, independently reproduced                                                                                                                                                |

**A skipped integration test is not marked PASS anywhere in this table**, per the audit brief's explicit instruction.

---

## 16. Architectural Compliance

Matches D1(B) — "migrate sales-service onto the shared valuation engine" — not D1(A) ("patch the stale local engine in place"). Confirmed: the local file is deleted, not patched; no new FEFO/batch logic was written inside `apps/sales-service`; all valuation logic now lives exclusively in `packages/platform-sdk/src/valuation-engine.ts`.

Confirmed Phase 2A did **not** silently decide any of the following, all correctly deferred:

- **Expiry policy** (D2) — no expiry-blocking code exists anywhere; `consumeFifoLayers` only reorders preference, never gates. Confirmed by reading the full method (§4).
- **Capability gating** — no `INVENTORY_BATCH` registry entry, no capability-check code in any sales-service or inventory-service route touched by this diff.
- **Batch activation / write path** — confirmed zero `fefoEnabled` write path exists (§6).
- **Business-profile architecture** — untouched; Phase 2A's diff has no relationship to `business_types`/`industries` concepts.

---

## 17. Security Assessment

- **Tenant isolation**: every `ValuationService` call site passes `tenantId` from the authenticated request/service context (traced through `InvoiceService`/`SaleReturnService`'s existing parameter chain, unchanged by this migration) — not from unvalidated client input. The shared engine itself scopes every query with `eq(items.tenantId, tenantId)`/`eq(inventoryFifoLayers.tenantId, tenantId)` (confirmed in source, §4). No change to this pattern from the migration — only the import source changed, not the call-site argument construction.
- **Authorization**: no route-level auth/permission-guard code was touched by this diff (`git diff --stat` shows zero changes to any `.routes.ts` file).
- **Cross-tenant exposure**: none found — no new cross-service call, no new client-facing endpoint, no new field exposed in any API response.

**No security regression identified in Phase 2A's own diff.**

---

## 18. Performance Assessment

The shared engine's `consumeForStockOut` select adds one extra column (`fefoEnabled`) to an existing single-row `SELECT ... FOR UPDATE` — negligible, not a new query. `applyStockIn`'s FIFO-layer insert adds two extra optional columns to an existing insert — no new query. No new round-trip, no new N+1 pattern, no missing index concern introduced (the `fefoEnabled`-aware `orderBy` still hits the same `inventory_fifo_layers` rows the FIFO-only query already scanned; `idx_fifo_layers_fefo_order` referenced in `26-decision-record.md` is a pre-existing index, not new to this phase). **No regression found; not applicable to optimize since nothing changed in query shape for the reachable (`fefoEnabled=false`) case.**

---

## 19. Findings and Severity

| #   | Finding                                                                                                                                                                                                                  | File                                                                                                                                                 | Severity          | Pre-existing / Introduced                                                                                          | Blocks 2A closure?                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| F1  | `valuation-fefo.test.ts` and `sale-return-batch-traceability.test.ts` have never been executed against a real database, in any session to date                                                                           | `apps/sales-service/src/__tests__/{valuation-fefo,sale-return-batch-traceability}.test.ts`                                                           | **LOW**           | Introduced by 2A (the tests are new), but the _cause_ (no DB infra in sandbox) is environmental, not a code defect | **Yes — blocks 2B authorization specifically, not 2A's own closure**, per the report's own stated next step        |
| F2  | Sale-return batch/expiry traceability gap remains open (confirmed independently, not fixed, correctly documented)                                                                                                        | `apps/sales-service/src/domain/SaleReturnService.ts:233`                                                                                             | **INFORMATIONAL** | Pre-existing (confirmed — the local engine never had these fields either)                                          | No — explicitly out of scope, correctly deferred                                                                   |
| F3  | Unrelated, uncommitted Phase 1 Capability Foundation work sits in the same working tree as Phase 2A's changes, unmentioned by the implementation report                                                                  | `packages/platform-sdk/src/capability-guard.ts`, `packages/shared-types/src/capability-registry.ts`, `apps/auth-service/src/routes/users.ts`, others | **INFORMATIONAL** | Pre-existing/concurrent, not produced by Phase 2A                                                                  | No — but recommend separating before any commit touching these files                                               |
| F4  | The engine-level FEFO test (`packages/platform-sdk/src/__tests__/valuation-engine-fefo.test.ts`), cited as prior proof that FEFO ordering "already works," is itself DB-gated and has also never run in this environment | `packages/platform-sdk/src/__tests__/valuation-engine-fefo.test.ts`                                                                                  | **INFORMATIONAL** | Pre-existing (predates Phase 2A)                                                                                   | No — but tempers confidence in "already proven" language used in planning docs; should be run alongside F1's tests |
| F5  | 19 sales-service test files hardcode JWT issuer `'erp-test'` (broader than the 12 the report calls out as failing)                                                                                                       | `apps/sales-service/src/__tests__/*.test.ts`                                                                                                         | **INFORMATIONAL** | Pre-existing, tracked in session memory since 2026-07-30                                                           | No                                                                                                                 |

**No BLOCKER. No HIGH. No correctness defect found in Phase 2A's own code changes.**

---

## 20. Final Verdict

**B. VERIFIED WITH FOLLOW-UPS** — the migration itself is implemented correctly, matches the approved D1(B) decision, is minimal and surgical, passes every test I could independently execute, and introduces no regression in any of the three sibling consumers or in accounting. The follow-ups are exactly the ones the implementation report already named: run the two new integration tests (plus, I'd add, the platform-sdk engine-level FEFO test) against a real Postgres instance to convert "written" into "proven," and — a new observation from this review — separate or commit the unrelated Phase 1 work currently commingled in the working tree before it gets swept into an unrelated commit.

## 21. Phase 2B Readiness

**Can Phase 2B begin? NO.**

Before Phase 2B is authorized:

1. **Run `valuation-fefo.test.ts`, `sale-return-batch-traceability.test.ts`, and `valuation-engine-fefo.test.ts` against a real PostgreSQL instance** and get an actual pass, not a skip. This is the single concrete gap between "code-complete" and "proven" for 2A-3/2A-4, and it is exactly what the D1(B) migration was supposed to buy — confidence that FEFO is wired through the real call path, not just present in the engine.
2. **Resolve D4** (capability-disable behavior) with explicit user confirmation — `31-revised-acceptance-criteria.md` §0 lists this as still open and blocking for 2B ship, independent of anything found in this review.
3. **Either resolve D2 (expiry policy) or explicitly ratify "ordering-preference only, no gating" as v1 scope** — also still open per the same preconditions table, not touched by this review.
4. **Recommended, not strictly blocking**: separate the uncommitted Phase 1 Capability Foundation files (§14, §19 F3) from the tree before any Phase 2A or Phase 2B commit, so the two initiatives' history stays legible and a future `git add -A` doesn't accidentally bundle them.

Nothing found in this review suggests Phase 2A needs rework — the gap is entirely "prove it ran," not "fix what's wrong."
