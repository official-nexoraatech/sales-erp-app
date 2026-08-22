# 33 — Revised Executive Summary & Decision Record

Supersedes `23-executive-summary.md`'s conclusions (not deleted — see `README.md`). Written in direct response to `24-pre-implementation-review.md`'s NOT READY verdict, per the governing brief for this revision session. No source file, migration, or config was changed to produce this document set — verified: this session ran zero `Edit`/`Write` calls against `apps/`, `packages/`, or `packages/db-client/migrations/`, only against `ERP-PLANNING/`.

## 1. What was wrong with the original Phase 2 plan

Its central technical premise — "FEFO consumption ordering doesn't exist anywhere; this phase adds it" — was factually false. FEFO ordering already exists, is tested, and is live in `packages/platform-sdk/src/valuation-engine.ts`, consumed today by `inventory-service`, `purchase-service`, and `production-service`. The plan's own evidence-gathering (`01-current-code-evidence.md`) read only `apps/sales-service`'s local, stale, non-FEFO `ValuationService.ts` and concluded the capability didn't exist anywhere. As a direct consequence, the plan: under-scoped the service impact (missed `production-service` entirely, mischaracterized `purchase-service` as "no change" when purchase returns are a live affected route); under-scoped the testing strategy (missed five of nine always-on flows that already run the FEFO-aware engine and will silently change behavior once the write path opens); and overstated financial neutrality (`07-api-contracts.md` §4 claimed reordering never changes COGS — false whenever consumed layers carry different unit costs, the normal case).

## 2. What is already implemented

FEFO consumption ordering (tie-break/NULLS-last/partial-quantity handling, all correct and tested) in the shared engine; row-level locking safe against double-allocation (independently re-verified, `FOR UPDATE` on `items` then all candidate layers, held for the transaction's life); GRN batch/expiry capture (unconditional, correctly REUSABLE DOMAIN, not gated); near-expiry alerting (`nearExpiryAlert.job.ts`, independent of `fefoEnabled`); the entire schema (`0165_inventory_batch_expiry_fefo.sql`). Confirmed this session, with exact current line numbers, via direct code reads and two independent research passes.

## 3. What actually needs to change

Not "add FEFO." **Reconcile `apps/sales-service`'s stale duplicate valuation engine with the shared, proven one** (D1) — this is the actual, unavoidable core of the phase, previously invisible to the plan. Then correctly scope the capability-gating work across all four services and nine consumption/capture flows instead of three services and effectively two. Then decide, explicitly, what "FEFO" does and doesn't guarantee about expired stock (D2) before any tenant can reasonably infer more than what's actually built.

## 4. Recommended Sales valuation architecture

**Migrate `apps/sales-service` onto the shared `@erp/sdk` valuation engine** (D1, option B), removing the local duplicate (`ValuationService.ts`, and its three confirmed callers — `InvoiceService.ts`, `SaleReturnService.ts`, and `LoyaltyService.ts`, the last found only during this session's re-verification). Recommended over patching the local copy in place because patching still requires re-implementing already-tested ordering logic and re-adding fields the shared engine already has, arrives at a permanently-duplicated result, and directly recreates the "ledger services duplicate domain logic, confirmed drift bugs" pattern that produced this NOT READY verdict in the first place. Full analysis: `26-decision-record.md` D1. **This is a recommendation, not an authorization** — the user must confirm before Phase 2A's code is written, because it is the larger, riskier option, touching live invoice/POS/returns code paths.

## 5. Recommended expiry policy

**None recommended — explicitly left open (D2).** Current code (both engines) never blocks consumption of expired stock; FEFO only reorders preference. Per-flow analysis (`29-expiry-policy-analysis.md`) shows the risk profile genuinely differs by flow — sale/POS/production-material-issue carry real regulatory exposure where a hard block is defensible, while adjustments/physical-verification are the _resolution_ mechanism for expired stock and should probably never be blocked — which argues against a single blanket policy but does not resolve the question. The user must either ratify "ordering-preference only, no gating" as the deliberate v1 scope (with mandatory UI disclosure) or specify a per-flow policy for a future Phase 2C.

## 6. Financial impact

Real, not neutral: COGS, inventory valuation, and period-level gross profit/P&L change per-transaction whenever FEFO selects a differently-costed layer than FIFO would have — confirmed by tracing the exact code path from `InvoiceService`'s COGS computation through the `COGS_CALCULATED` event to `accounting-service`'s `CogsAccountingConsumer.ts`, which posts whatever `cogsTotal` it's given without recomputation. **`AccountingService` does not need modification** — the analysis proves the fix is entirely upstream, in which engine sales-service uses (D1). No retroactive change to any tenant's historical figures; the change is prospective-only, per-item, and only takes effect once an admin explicitly opts an item in via Phase 2B. Full analysis: `28-financial-impact-analysis.md`.

## 7. Recommended phase split

- **Phase 2A** — canonical valuation engine consolidation (D1), shipped and stabilized in isolation. Carries zero financial-behavior change for any tenant on merge, since no item can be `fefoEnabled: true` before Phase 2B exists — this sequencing is what makes R1 (the gate review's root-cause risk) structurally impossible rather than a discipline requirement.
- **Phase 2B** — the original plan's registry/RBAC/migration/frontend mechanics (largely unrevised, still sound), plus the corrected, complete nine-flow test matrix the original plan never had.
- **Phase 2C** (not scoped, blocked on D2) — any expiry-blocking/warning policy, a genuinely separate, larger feature.

Full detail: `25-revised-scope.md` §6, `30-revised-file-level-change-plan.md`.

## 8. Remaining open decisions

| #   | Decision                                                                        | Status                                                                                                     |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | Sales-service reconciliation: migrate vs. patch                                 | Recommendation given (migrate) — **blocking**, needs user confirmation                                     |
| D2  | Expired-stock policy, per flow                                                  | **Open**, business input required — not blocking 2A/2B if the "no gating" v1 scope is explicitly disclosed |
| D3  | Batch-targeted correction workflows (adjustments/verification/purchase-returns) | Recorded, non-blocking, needs a yes/no when convenient                                                     |
| D4  | Capability-disable behavior for already-`fefoEnabled` items                     | Recommendation given (leave as-is) — non-blocking for 2A, needs confirmation before 2B ships               |

Plus two newly-identified, smaller gaps not blocking this phase but tracked: job-work finished-goods receipts don't carry batch/expiry forward (R6); stock transfers don't carry batch/expiry identity to the destination warehouse's new layer (R7).

## 9. Revised implementation scope

Four services now correctly identified as affected (`inventory-service`, `purchase-service`, `production-service`, `sales-service` — not three), nine consumption/capture flows with explicit test coverage requirements (not effectively two), one prerequisite code-consolidation phase the original plan never budgeted for, zero new tables/columns (schema was already complete), one migration (`0169`, unchanged in shape from the original plan), zero `AccountingService` changes (proven unnecessary, not just assumed). Full detail: `27-affected-flow-matrix.md`, `30-revised-file-level-change-plan.md`, `31-revised-acceptance-criteria.md`.

## 10. Recommended next step

Present D1 (and ideally D2, D4) to the user for a decision. Do not begin Phase 2A implementation until D1 is confirmed — per the brief's explicit instruction, this document set does not claim "READY FOR IMPLEMENTATION" while a blocking business/architectural decision remains open, and it isn't one. Once D1 is confirmed, this revised plan (`25`–`33`, plus the unrevised-but-still-valid `03`, `06`, `08`–`14`, `18`, `19`) is ready to resubmit for a follow-up independent gate review before any code is written, per `24-pre-implementation-review.md` §16's own recommended path to READY.
