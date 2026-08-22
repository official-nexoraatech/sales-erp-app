# 16 — Phase Roadmap

Reordered against actual codebase dependencies found in `01-current-state.md`/`02-gap-analysis.md`, not the brief's default sequence. Two changes from the brief's suggested order, both evidence-driven:

- **The CRM/O2C service split (brief's implicit "service boundary" work) is pulled forward to run alongside Phases 1–4**, not deferred to Phase 10, because sales-service's God-service problem (G3) directly affects how cleanly any new industry that touches CRM-adjacent capability (loyalty, referrals — most retail-adjacent verticals) can be onboarded. It was already fully planned in a prior session; this roadmap treats executing that existing plan as parallel, not sequential, track.
- **Commerce Core generalization (batch/expiry, UOM — G8) is pulled forward to before Phase 10**, not left as a "first new industry" side effect, because it's needed by Grocery today and by most realistic next industries (see `19-first-industry-recommendation.md`).

## Phase 0 — Architecture Discovery & Baseline ✅ (this document set)

Objective: establish evidence-based current state, gaps, target model. Scope: read-only. **Status: complete as of this planning pass.**

## Phase 1 — Business Profile Foundation

- Objective: `industries`/`business_types` tables, `tenants.business_type_id`, sync helper (`15-migration-strategy.md` steps 1–2).
- DB: 1 new migration (2 tables + 1 FK column + backfill).
- Backend: `setTenantBusinessType()` helper in `tenant-service`; `TenantProvisioner` untouched (still reads `vertical`).
- Frontend: none.
- Security: none (additive schema only).
- Testing: migration idempotency test, backfill correctness test (`vertical` ↔ `business_type_id` stay in sync).
- Rollback: drop new table/column.
- Completion criteria: every existing tenant has a correct `business_type_id`; all 4 existing `vertical` call sites pass unmodified.

## Phase 2 — Module / Capability Registry

- Objective: `MODULE_REGISTRY` (code), `MODULE_PERMISSION_PREFIXES`, `business_types.default_module_keys` seeded from today's `VERTICAL_DEFAULTS`.
- DB: none (code + seed-data update to Phase 1's tables).
- Backend: new `packages/shared-types/src/modules.ts`, `module-permissions.ts`.
- Frontend: none yet.
- Security: none.
- Testing: registry-completeness test (every existing feature-flag-gated module has a registry entry, or is explicitly marked Commerce-Core/always-on).
- Rollback: delete new files, no runtime dependents yet.
- Completion criteria: registry covers HR, POS, CRM (as currently sales-service-hosted), Production, GST as a minimum.

## Phase 3 — Tenant Module Entitlements (gating, inert)

- Objective: `requireModule()` preHandler, `isModuleEnabled()` helper reading `PlatformFeatureFlags` through the registry.
- DB: none.
- Backend: new `packages/platform-sdk/src/module-gate.ts`.
- Frontend: none.
- Security: reuses existing tenant-scoped flag lookups — no new trust surface.
- Testing: unit tests against a mocked `PlatformFeatureFlags`; deployed but not attached to any route yet (verifiable no-op).
- Rollback: trivial (unused code).
- Completion criteria: `requireModule('hr')` correctly resolves true/false against real seeded flags in an integration test, with zero routes actually using it yet.

## Phase 4 — RBAC + Capability Integration

- Objective: wire `requireModule` onto HR and Production route trees (the two modules with the clearest "can be legitimately absent" precedent today).
- DB: none.
- Backend: `apps/hr-service`, `apps/production-service` route preHandlers gain `requireModule('hr')`/`requireModule('production')` ahead of existing `requirePermission`.
- Frontend: none yet.
- Security: new, clearer 403 reason (`MODULE_NOT_ENABLED`) — verify it doesn't leak more information than the existing permission-denied response.
- Testing: route-level tests — module disabled + permission present → blocked; module enabled + permission present → allowed (mirrors existing `tenant-admin-authz.test.ts`-style pattern).
- Rollback: remove the preHandler call, zero schema impact.
- Completion criteria: HR/Production routes correctly gate on module state in a live integration test against a tenant with the module disabled.

## Phase 5 — Dynamic Capability-Aware Navigation

- Objective: `enabledModules` in the frontend session payload; `filterNavItem` module check; `moduleCode` tagged on HR & PAYROLL nav group (matching Phase 4's route gating).
- DB: none.
- Backend: extend whatever endpoint supplies `permissions[]` today to also return `enabledModules: string[]`.
- Frontend: `navigation.ts` (additive `moduleCode` field + filter predicate), `Layout.tsx` unchanged (already consumes the filtered result generically).
- Security: none new.
- Testing: RTL/unit test — nav group hidden when module disabled, permission-holding user still sees it when module enabled.
- Rollback: revert the filter predicate; nav returns to permission-only filtering.
- Completion criteria: manually verified in-browser on a tenant with HR disabled (per CLAUDE.md's UI-testing requirement — start the dev server, toggle the flag, confirm the nav group disappears and reappears).

## [Parallel track, Phases 1–5] CRM/O2C Service Split Execution

- Objective: execute the already-fully-scoped split (`reportsengine_dedup_and_crm_split_2026_08_16`) — Opportunity Won→Quotation outbox redesign, bulk-migrate CRM-only files to `crm-service`, split mixed files, retarget ~13-15 frontend API objects.
- Not re-planned here — this roadmap only asserts sequencing: **should complete before or during Phase 10**, not after, since Phase 10's industry choice may need CRM-adjacent capability (loyalty/referrals) in a clean, separately-deployable service.
- Dependencies: none on Phases 1–5; can run fully in parallel.
- Risk: High (financial/CRM-transactional stakes) — already flagged as needing several dedicated sessions with git-stash isolation per test file, per the existing plan.

## Phase 6 — Configuration Architecture (documentation) ✅ Done 2026-08-21

- Objective: write down the layering described in `09-configuration-model.md` as a real doc for future contributors; no new mechanism.
- Scope: docs only.
- Completion criteria: `ERP-PLANNING/multi-industry-platform/09-configuration-model.md` (already produced by this pass) is cross-linked from `CODING_STANDARDS.md` or `ERP_MASTER_SPEC.md`. **Done** — cross-linked from `CODING_STANDARDS.md`'s Naming Conventions section, alongside the existing `EVENT_GOVERNANCE.md` link.

## Phase 7 — Event / Domain Governance (documentation) + Commerce Core generalization ✅ Done — fully closed 2026-08-22

- Objective A: write `EVENT_GOVERNANCE.md` codifying naming/ownership/versioning/idempotency conventions already implicit in the code (`10-event-architecture.md`). **Done 2026-08-20** — see `ERP-PLANNING/EVENT_GOVERNANCE.md`, cross-linked from `CODING_STANDARDS.md`'s Events section.
- Objective B, **correction**: the Commerce Core generalization this slot was reserved for (batch/lot + expiry propagation, UOM conversion) was built between the original planning pass and this update — migrations `0165_inventory_batch_expiry_fefo.sql`/`0166_purchase_unit_conversion.sql`, consumed by real code (`GRNService.ts`, `nearExpiryAlert.job.ts`). See `02-gap-analysis.md` G8's correction note. Multi-buy pricing (`PromotionService.ts`/`PromotionEngine.ts`) and POS day-end settlement (`DayEndSettlementService.ts`) — both originally scoped for later Grocery-maturity phases — also shipped in the same pass.
- **Remaining in this slot**: all three closed. (1) FEFO consumption-order — closed, see `f2_fefo_test_gap_closed_2026_08_20` memory. (2) `inventory`/`purchase`/`production`/`sales` stock-mutation triplication — **confirmed closed 2026-08-22**, verified directly against code (not planning docs): zero local `ValuationService.ts` duplicates remain anywhere in `apps/*/src`, every stock-touching service imports the same `ValuationService` from `@erp/sdk` (`packages/platform-sdk/src/valuation-engine.ts`), including the warehouse-WACC helpers. Per-service `inventory_ledger` row inserts remain local by correct design (can't share a cross-service Postgres transaction), not unconsolidated logic. (3) `EVENT_GOVERNANCE.md` — written 2026-08-20.
- Dependencies: none on Phases 1–6; independent engineering track.
- Completion criteria: all met — Phase 7 is fully done.

## Phase 8 — Reporting / Search / Audit Hardening ✅ Done 2026-08-21

- Objective: adopt the projection-preference policy for new analytical work (`11-reporting-architecture.md`); no retrofit of existing reports. **Policy-only, already in force** — every report built this initiative (Manufacturing BOM, Distribution) read from existing tables/projections, no new ad-hoc cross-service query was introduced.
- Objective: document the search onboarding checklist (`12-search-architecture.md`) so a Phase-10 industry's new entity types follow the existing isolation pattern correctly on first attempt. **Done** — see `24-search-onboarding-checklist.md`.
- Scope: mostly documentation + a template/checklist, not new subsystems.

## Phase 9 — Security and Tenant Isolation Hardening 🔶 Pilot shipped 2026-08-21, rollout ongoing

- Objective: close the GUC-per-request gap (`13-security-architecture.md` §2 step 1) — necessary regardless of RLS timing, and independently valuable. **Fix built and live-verified on one route file** (`production-service`'s `bom.routes.ts`) — see `23-guc-per-request-rollout-checklist.md` for the mechanism (`@erp/sdk`'s `tenantScopedHandler`/`withTenantConnection`), why a first attempt (`sql.reserve()`) was a dead end, and the checklist for migrating the remaining route files across all 15 services. Deliberately not blanket-applied in one pass — same table-by-table, monitored caution this doc itself prescribes for RLS.
- Objective (stretch, evidence-gated): begin table-by-table RLS rollout on financial tables, only after the GUC fix is verified stable in production-equivalent load. **Still blocked on the rollout above completing** — RLS remains unenabled.
- Dependencies: none on Phases 1–8, but should land before tenant/service count grows further (risk grows with scale, not with this plan's other work).

## Phase 10 — First New Industry Vertical

- Objective: onboard the industry selected in `19-first-industry-recommendation.md` using the now-complete Business Profile + Module Registry + capability-aware nav pipeline (Phases 1–5), on a sales-service that's either fully split (parallel track) or split enough to not add more weight to it.
- Full phase detail deferred to a dedicated planning pass once the industry is confirmed with the user — this roadmap only asserts readiness criteria: Phases 1–5 complete, CRM/O2C split complete or far enough along that the new industry doesn't need to touch sales-service's CRM code, Phase 7's Commerce Core generalization complete if the chosen industry needs batch/expiry (see `19-first-industry-recommendation.md` for which candidates do).

## Phase 11 — Productization / Subscription Entitlements

- Objective: resume PG-027 Sessions 2–3 (payment gateway, billing-cycle job, admin UI) plus PG-012 (tenant suspension enforcement — hard dependency, currently a no-op). Explicitly **not implemented by this initiative** — flagged as its own, already-partially-scoped, separately-prioritized track.

## Phase 12 — Future Industry Expansion Framework

- Objective: once 2 new industries (Grocery already shipped, Phase 10's pick) have gone through the Business Profile pipeline, review whether the `MODULE_REGISTRY`/`business_types` model needs generalizing further (e.g. capability-level entitlement, per `04-domain-model.md` §6's escape hatch) — a review checkpoint, not pre-built speculative infrastructure. **Done 2026-08-20** — see `22-phase12-expansion-framework-review.md`: model sound, not proven under load (Distribution never exercised new-capability creation); found a real, undetected `VERTICAL_DEFAULTS`/`business_types.defaultCapabilityKeys` duplication to resolve; recommends Manufacturing as the 3rd industry.
- **Manufacturing vertical (4th industry) shipped as the review's own recommendation, in two phases**: Phase A (BOM, 2026-08-20) — single-level Bill of Materials, `JobWorkOrderService` auto-populates materials from a BOM's `explode()`. Phase B (Work Centers, 2026-08-21) — production stations/machines a Job Work Order can optionally reference; the dependency root for Routing/MRP, both still deliberately deferred (no Routing/MRP/multi-level BOM/standalone Production Order concept exists yet — a future session's own right-sized next slice, not started this pass).

---

## Summary dependency graph

```
Phase 0 (done)
   │
   ├── Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5   (Business Profile pipeline)
   │        \                                    /
   │         \  CRM/O2C split (parallel track)  /
   │          \________________________________/
   │
   ├── Phase 6 (docs, independent)
   ├── Phase 7 (Commerce Core generalization, independent engineering track)
   ├── Phase 8 (docs + checklist, independent)
   ├── Phase 9 (security hardening, independent)
   │
   └── Phase 10 (First New Industry) — gated on Phases 1–5 + CRM split + Phase 7 (if needed)
           │
           └── Phase 11 (billing, separate track) ── Phase 12 (review checkpoint)
```
