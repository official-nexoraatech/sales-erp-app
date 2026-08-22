# 30 — Revised File-Level Change Plan

Supersedes `21-file-level-change-plan.md`'s Step 3 and its "Not touched by this phase" list. Split into **Phase 2A** (blocking prerequisite, contingent on D1's confirmation) and **Phase 2B** (the original plan's mechanical scope, now correctly covering all affected flows). Phase 2C (expiry gating) is intentionally not detailed here — it cannot be file-level-planned until D2 is resolved (`29-expiry-policy-analysis.md`).

**Nothing in this document is authorization to write code.** It is the plan that becomes actionable once D1 (and ideally D4) are confirmed by the user.

---

## Phase 2A — Canonical valuation engine consolidation (prerequisite, must ship and stabilize before 2B)

Only proceeds if the user confirms D1(B) (migrate) per `26-decision-record.md`. If the user instead chooses D1(A) (patch in place), this section's file list changes materially — see the note at the end.

### Step 2A.1 — Behavioral-equivalence baseline (before touching any file)

| Action                                      | Detail                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diff the two engines line-by-line           | `apps/sales-service/src/domain/ValuationService.ts` (287 lines) vs. `packages/platform-sdk/src/valuation-engine.ts` — beyond the FEFO ordering and missing batch/expiry fields already identified, confirm no other silent divergence exists (differing landed-cost handling, differing WACC rounding, differing error types) per R2 in `32-revised-risk-register.md` |
| Capture current sales-service test behavior | Run `invoice-ledger.test.ts`, `invoice-validation.test.ts`, `sales-workflow.test.ts`, and POS/`SaleReturnService`-adjacent tests against the **current** local engine; record pass/fail as the baseline the migration must reproduce exactly for the non-FEFO case                                                                                                    |

**Verify**: a written diff exists identifying every behavioral difference between the two engines, not just the ones already known.

### Step 2A.2 — Migrate call sites

| File                                                    | Change                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/sales-service/src/domain/InvoiceService.ts:32`    | Remove `import { ValuationService } from './ValuationService.js';`; add `ValuationService` to the existing `@erp/sdk` import block (lines 19-28) |
| `apps/sales-service/src/domain/SaleReturnService.ts:18` | Same import change                                                                                                                               |
| `apps/sales-service/src/domain/LoyaltyService.ts`       | Same import change — newly confirmed third caller of the local engine this session; must not be missed                                           |
| `apps/sales-service/src/domain/ValuationService.ts`     | Delete, once all callers are migrated and the equivalence suite (2A.3) passes — not before                                                       |

**Verify**: `grep -r "from './ValuationService.js'" apps/sales-service/src` returns zero matches; typecheck clean.

### Step 2A.3 — Behavioral-equivalence regression suite

| File                                                                             | New/extended test                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/sales-service/src/__tests__/valuation-migration-equivalence.test.ts` (new) | For every existing `fefoEnabled=false`-implicit test case (all of them, since no item can be `true` yet), assert byte-identical `cogsPerUnit`/`invoiceCogsTotal` output between what the local engine used to produce (2A.1's baseline) and what the shared engine now produces, for invoice confirm, invoice cancel (reversal), POS checkout, sale return, and the loyalty reversal path |
| Existing suites re-run unmodified                                                | `invoice-ledger.test.ts`, `invoice-validation.test.ts`, `sales-workflow.test.ts`, POS tests, `SaleReturnService` tests — must all pass with zero changes to their own assertions (only the import under test changed)                                                                                                                                                                     |

**Verify**: 100% pass, zero assertion changes needed in pre-existing tests (a changed assertion would indicate a real behavioral divergence, which must be explained and resolved before proceeding, not silently accepted).

### Step 2A.4 — FEFO test coverage for the now-unified sales path

| File                                                                                                                                                     | New test                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/sales-service/src/__tests__/valuation-fefo.test.ts` (new, mirrors `packages/platform-sdk/src/__tests__/valuation-engine-fefo.test.ts`'s structure) | `fefoEnabled: true` item with mixed-expiry layers consumed via `InvoiceService.confirm()` (both direct invoice and POS-routed) selects the earliest-expiring layer first; `fefoEnabled: false` (still the only real-world case at this point) unchanged |
| `apps/sales-service/src/__tests__/sale-return-batch-traceability.test.ts` (new)                                                                          | Sales-return restock now carries `batchNumber`/`expiryDate` through to the new `inventory_fifo_layers` row (closes the traceability gap, `27-affected-flow-matrix.md` #10)                                                                              |

**Verify**: FEFO ordering test passes through the real `InvoiceService`/`SaleReturnService` call path, not just the engine in isolation (2A.3 already proved the engine itself; this proves the integration).

### Step 2A.5 — Full regression + sign-off

Per `16-testing-strategy.md` §3's discipline (`git stash -u` comparison, full `turbo run type-check`, full `turbo run test --continue`). **At the end of Phase 2A, zero tenant sees any behavior change** — no item can be `fefoEnabled: true` yet, so this phase is purely an internal consolidation, verifiable in isolation before Phase 2B exposes it to any real configuration.

**If D1(A) — patch in place — is chosen instead**: Steps 2A.2/2A.4 change to editing `apps/sales-service/src/domain/ValuationService.ts` directly (add `fefoEnabled` param to `consumeFifoLayers`, add `batchNumber`/`expiryDate` to `StockInValuationParams`) rather than deleting it; Step 2A.3's equivalence suite becomes a same-file regression instead of a cross-implementation diff; Step 2A.1's line-by-line diff step is skipped (nothing to reconcile against, since the file isn't being replaced) but the FEFO-ordering test-writing burden in 2A.4 is not reduced — it still needs writing from scratch, since it can't reuse `valuation-engine-fefo.test.ts`.

---

## Phase 2B — `INVENTORY_BATCH` capability (depends on 2A complete and merged)

Materially the original plan's Step 1/2/4/5, corrected per `27-affected-flow-matrix.md` to include the previously-missing test coverage for the five silently-affected always-on routes.

### Step 2B.1 — Registry & permissions (no runtime effect yet)

Unchanged from `21-file-level-change-plan.md` Step 1: `capability-registry.ts` gains `INVENTORY_BATCH` (`03-capability-definition.md` §2, unrevised and still correct); `permissions.ts` gains `BATCH_VIEW`/`BATCH_CONFIGURE`; `role-defaults.ts` grants per `08-permissions-and-rbac.md` §2 (unrevised).

### Step 2B.2 — Migration

Unchanged from `21-file-level-change-plan.md` Step 2, migration number `0169_*.sql` (confirmed as the correct next number — highest existing is `0168_pos_day_end_settlements.sql`, re-verify at implementation time per the standing numbering risk). Flag seed + permission backfill, per `06-database-impact.md` (unrevised).

### Step 2B.3 — Backend: item configuration (unchanged from original Step 3's item-routes portion)

| File                                                  | Change                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/inventory-service/src/schemas/*` (`ItemSchema`) | Add optional `fefoEnabled: boolean`                                                                                                  |
| `apps/inventory-service/src/api/item.routes.ts`       | In-handler capability check on `POST /items`/`PUT /items/:id`, fail-closed per `15-security-impact.md` §2 (unrevised, still correct) |
| `apps/inventory-service/src/__tests__/*`              | New tests per the A-E outcome matrix                                                                                                 |

### Step 2B.4 — Backend: consumption-ordering test coverage across ALL nine flows (the corrected core of this step)

This replaces the original plan's Step 3 sales-service-only scope. No production code change is needed in these files beyond what 2A already merged — **the gap being closed here is test coverage**, since these flows already run the FEFO-aware shared engine and will start actually exercising the FEFO branch the moment 2B.3 makes `fefoEnabled` settable.

| File                                                                                                | New test                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/inventory-service/src/__tests__/stock-transfer-fefo.test.ts` (new)                            | Flow #1, per `27-affected-flow-matrix.md`                                                                                       |
| `apps/inventory-service/src/__tests__/stock-adjustment-fefo.test.ts` (new)                          | Flow #2                                                                                                                         |
| `apps/inventory-service/src/__tests__/physical-verification-fefo.test.ts` (new)                     | Flow #3                                                                                                                         |
| `apps/purchase-service/src/__tests__/purchase-return-fefo.test.ts` (new)                            | Flow #5                                                                                                                         |
| `apps/production-service/src/__tests__/job-work-order-fefo.test.ts` (new)                           | Flow #6                                                                                                                         |
| `apps/sales-service/src/__tests__/valuation-fefo.test.ts`, `sale-return-batch-traceability.test.ts` | Already delivered in Phase 2A Step 2A.4 (flows #8, #9, #10) — re-run here as part of the full-matrix regression, not re-written |

**Verify**: all nine flows in `27-affected-flow-matrix.md` have a passing FEFO-ordering test plus a `fefoEnabled=false` regression test, closing the gap the original `16-testing-strategy.md` never covered.

### Step 2B.5 — Backend: new report route

Unchanged from `21-file-level-change-plan.md` Step 4: `GET /inventory/near-expiry-stock`, `preHandler: [authenticate, requireCapability('INVENTORY_BATCH', db, redis), requirePermission(BATCH_VIEW)]`.

### Step 2B.6 — Frontend

Unchanged from `21-file-level-change-plan.md` Step 5: nav item, item-form toggle, near-expiry stock page, `endpoints.ts` client method. Add explicit UI/help-copy disclosure per `28-financial-impact-analysis.md` §5 and `29-expiry-policy-analysis.md` §4 item 4: enabling `fefoEnabled` changes future COGS sequencing and does **not** block expired stock — both facts must be visible to the admin toggling it on, not buried in engineering documentation only.

### Step 2B.7 — Full regression + sign-off

Per `16-testing-strategy.md` §3, extended to cover the nine-flow matrix.

---

## Not touched by Phase 2A or 2B

`apps/hr-service/*`, `apps/crm-service/*`, `apps/api-gateway/*` (route registration confirmed zero-work per `24-pre-implementation-review.md` §7), any migration below `0169`, `industries`/`business_types` (don't exist), `tenants.vertical`, any CRM/O2C-split-adjacent file, `AccountingService` (`28-financial-impact-analysis.md` §10 — analysis proves no change required), any file implementing an expiry-blocking policy (Phase 2C, not scoped until D2).
