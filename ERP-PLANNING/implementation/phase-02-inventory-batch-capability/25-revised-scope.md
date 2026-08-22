# 25 — Revised Scope (post gate-review)

Status: Planning only. No source file, migration, or config changed to produce this document set. Written 2026-08-18, in direct response to `24-pre-implementation-review.md`'s **NOT READY** verdict. This document and `26`–`33` supersede the _conclusions_ of `01`, `04`, `05`, `07`§4, `16`, `20`, `21`, `22`, `23` where they conflict, but those files are left in place unmodified — see `README.md` for the authoritative reading order.

---

## 1. What changed

The original Phase 2 plan (`00`–`23`) was built on one factual claim: _"FEFO consumption ordering does not exist anywhere in the codebase; this phase adds it."_ The independent gate review (`24-pre-implementation-review.md`) established that claim is false. This changes what Phase 2 actually is.

## 2. Old objective (superseded)

> "Build FEFO consumption ordering into `ValuationService.consumeFifoLayers` and gate it behind a new `INVENTORY_BATCH` capability."

## 3. New objective

> **Capability-gate and productionize the existing Inventory Batch / Expiry / FEFO capability across all affected inventory flows, while establishing one authoritative valuation/consumption implementation and explicitly defining expiry and financial behavior.**

This is a reframing, not a scope expansion for its own sake. Three things are now known that weren't when the original plan was written:

1. **FEFO ordering already exists**, tested, and is live today in `packages/platform-sdk/src/valuation-engine.ts` (`consumeFifoLayers`), consumed by `inventory-service`, `purchase-service`, and `production-service`. It is currently dormant only because no item can be flagged `fefoEnabled: true` yet (no write path) — not because the ordering logic is missing.
2. **`apps/sales-service` runs a second, stale, un-migrated duplicate** of the same engine (`apps/sales-service/src/domain/ValuationService.ts`) that ignores `fefoEnabled` entirely. This is the actual code-level gap — not a missing `ORDER BY` clause, but a live financial-consumption engine that has silently diverged from its sibling. It is the consumption path for every invoice, every POS checkout, and every sales return.
3. **Five additional always-on routes** — stock transfers, stock adjustments, physical verification, purchase returns, and job-work order consumption — already run through the FEFO-aware shared engine and will silently change behavior the moment any item is flagged `fefoEnabled: true`, whether or not this phase adds a single line of new code to them. They were not in the original plan's testing strategy or service-impact analysis.

## 4. What is preserved from the original plan, unchanged

Per `24-pre-implementation-review.md` §12 ("Scope Review") and §16: the registry/RBAC/migration/frontend-nav/entitlement mechanics in `03-capability-definition.md`, `06-database-impact.md`, `08-permissions-and-rbac.md`, `09-navigation-and-frontend.md`, `10`–`14`, `18`, `19` are **sound and do not need rework**. The capability classification (item toggle = INDUSTRY CAPABILITY; GRN capture = REUSABLE DOMAIN, always-on; FIFO valuation itself = CORE) is correct and unchanged. `INVENTORY_BATCH` remains one capability, not split — see `26-decision-record.md` §5.

## 5. What is revised

- `01-current-code-evidence.md` §4, `04-domain-model.md` §2, `05-service-impact.md`, `07-api-contracts.md` §4, `16-testing-strategy.md`, `17-migration-and-backward-compatibility.md`, `20-acceptance-criteria.md`, `21-file-level-change-plan.md`, `22-risk-register.md`, `23-executive-summary.md` are all superseded in their conclusions by `27`–`33` below. None of them are deleted or edited in place — the original review must remain readable as a record of what was wrong and why (see `README.md`).

## 6. Phase split (detail: `30-revised-file-level-change-plan.md`)

The revised scope is too large for one implementation session at the original plan's risk tolerance — it now includes reconciling a live financial-consumption engine, which the original plan never budgeted for. Recommended split:

| Phase  | Content                                                                                                                                                                                                                                                                                                                       | Blocking on                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **2A** | Canonical valuation engine consolidation — resolve `sales-service`'s duplicate `ValuationService.ts` (dedup or patch, per `26-decision-record.md` D1), with full behavioral-equivalence testing. **No capability-gating, no `fefoEnabled` write path yet.**                                                                   | User decision D1                                                                |
| **2B** | `INVENTORY_BATCH` capability — item-level toggle, migration, permissions, nav, frontend, near-expiry route — the original plan's mechanical scope, now correctly covering all 9 affected flows in its test plan. Depends on 2A being merged (gating a still-diverged engine would reproduce the exact bug this review found). | 2A complete; user decision D4 (non-blocking, recommended default exists)        |
| **2C** | Expired-stock lifecycle (block/warn/configurable) across all 9 flows — a genuinely separate, larger feature. Not started until the business decides it's needed.                                                                                                                                                              | User decision D2 (business input required — see `29-expiry-policy-analysis.md`) |

## 7. What this phase still does NOT do

Unchanged from `00-overview.md` §6: no Distribution/Manufacturing/Hotel/Hospital industry build, no `industries`/`business_types` foundation, no CRM/O2C split work, no `HR_PAYROLL`/`POS` route-wiring, no `MULTI_UOM`. Additionally, per this revision: **2C (expired-stock guardrails) does not ship as part of "Phase 2"** — it is a named, tracked follow-up, not silently folded in or silently dropped.

## 8. Document map (new)

| File                                   | Contents                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `26-decision-record.md`                | D1 (sales-service architecture, recommended), D2 (expiry policy, OPEN), D3 (batch-targeted corrections, non-blocking), D4 (capability-disable behavior, recommended), capability-boundary confirmation |
| `27-affected-flow-matrix.md`           | All 9 consumption/capture flows × 11 dimensions                                                                                                                                                        |
| `28-financial-impact-analysis.md`      | COGS/valuation/GL/P&L impact, rollout and reconciliation requirements                                                                                                                                  |
| `29-expiry-policy-analysis.md`         | Options A/B/C per flow — explicitly marked OPEN, not decided here                                                                                                                                      |
| `30-revised-file-level-change-plan.md` | File-level plan for 2A/2B, contingent on D1                                                                                                                                                            |
| `31-revised-acceptance-criteria.md`    | Revised, phase-split-aware acceptance checklist                                                                                                                                                        |
| `32-revised-risk-register.md`          | Original P1–P7 + gate review's R1–R5, re-scoped to 2A/2B                                                                                                                                               |
| `33-revised-executive-summary.md`      | Full revised decision record                                                                                                                                                                           |
