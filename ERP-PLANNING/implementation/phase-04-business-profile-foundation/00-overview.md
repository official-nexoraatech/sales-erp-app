# 00 — Phase 4 (Business Profile Foundation): Overview

Status: Planning only. No code, migration, or config changed to produce this document set. Written 2026-08-19, immediately after `phase-03-hr-payroll-pos-enforcement` was planned and blocked on its own D1 decision. The user chose this as the next planning target from `41-phase-2b-closure-review.md` §14.3's three-option list (Business Profile Foundation / HR-POS enforcement / advance the CRM/O2C split) — the second option, HR/POS enforcement, was planned first (`phase-03-...`) and remains unimplemented, blocked independently of this phase.

## 1. Naming note — read before anything else

**This folder's number (`phase-04`) does not correspond to the source roadmap's numbering.** The source roadmap (`multi-industry-platform/16-phase-roadmap.md`) calls this work **"Phase 1 — Business Profile Foundation."** `00-roadmap-analysis.md` (written 2026-08-18) explicitly split it off the capability track as an independent, parallel workstream — not blocking, and not blocked by, `phase-01-capability-foundation` (source roadmap Phases 2-3) or `phase-02-inventory-batch-capability`/`phase-03-hr-payroll-pos-enforcement` (source roadmap Phases 4-7, out of order per `41`§14.1's already-documented numbering drift). This folder is numbered `04` purely because it is this repository's **fourth** implementation-planning folder chronologically, not because it is the fourth phase in any dependency order. Treat the folder number as a filesystem sequence, not a roadmap position — exactly the confusion `41`§14.1 already flagged for `phase-02`'s name, now recorded proactively here instead of being rediscovered.

## 2. What this phase is, in one sentence

Add the `industries`/`business_types` reference tables and `tenants.business_type_id`, with `tenants.vertical` retained as a synced, backward-compatible column — the schema foundation Phase 10 (first new industry) needs, decoupled from and not blocking any capability-enforcement work.

## 3. Why this phase, and why it's safe to do independently of Phase 3's blocked status

`00-roadmap-analysis.md` §B's own correction (re-verified, not re-derived from scratch, this session): capability resolution (`PlatformFeatureFlags`, `CAPABILITY_REGISTRY`) has zero runtime dependency on `business_type_id`/`industries` — it only reads `feature_flags`, keyed by `tenantId`, which already works for every tenant today regardless of whether this phase ships. This phase and `phase-03-hr-payroll-pos-enforcement` are genuinely independent tracks; nothing here waits on Phase 3's D1, and nothing in Phase 3 waits on this phase.

## 4. Why this phase is structurally lower-risk than Phase 3

Phase 3's central problem was that it added **enforcement** to already-active flows with unverified real-world flag state. This phase adds **zero enforcement of anything** — it is pure additive schema (`15-migration-strategy.md` steps 1-2), a backfill that recomputes a value from data that already exists (`vertical` → `business_type_id`, a 1:1 lookup, not a judgment call), and a thin write-path sync helper. No existing route gains a new check, no existing request can newly fail. This is confirmed, not assumed — see `01-current-code-evidence.md` §4 for why the backfill is provably lossless.

## 5. What this phase builds

- `industries` table (global reference data), seeded with one row: `COMMERCE`.
- `business_types` table (global reference data), seeded with two rows: `CLOTH_RETAIL`, `GROCERY`, both under `COMMERCE`.
- `tenants.business_type_id` (nullable FK to `business_types`), backfilled for every existing tenant from its current `vertical` value.
- `setTenantBusinessType()` helper (`apps/tenant-service`) — writes both `business_type_id` and keeps `vertical` in sync, so the existing call sites (`01-current-code-evidence.md` §2) never need to change.
- Zero change to `MODULE_REGISTRY`/`CAPABILITY_REGISTRY`, zero change to any route, zero change to navigation, zero change to any test beyond what's needed to cover the new table/helper.

## 6. The real open question this phase surfaces (recorded, not silently resolved)

`04-domain-model.md`'s original design (written before Phase 1 shipped) specifies `business_types.default_module_keys jsonb` — a **Module**-model field name, from the two-tier Module/Capability vocabulary `21-capability-resolution-architecture.md` later collapsed into one flat `CAPABILITY_REGISTRY`. Phase 1/2B/3 all use `CAPABILITY_REGISTRY` keys (`HR_PAYROLL`, `POS`, `INVENTORY_BATCH`) directly — there is no `MODULE_REGISTRY` in the running code, and per `phase-01-capability-foundation`'s own implementation report, none was ever built. **This phase's schema must decide: does `business_types`' new column store `default_module_keys` (a concept that was never actually implemented) or `default_capability_keys` (matching what's actually running)?** This is `25-decision-record.md` D1 — not blocking in the sense of "unsafe to proceed," but blocking in the sense of "the column name and its seed-data shape depend on the answer," so the migration cannot be finalized without it.

## 7. What this phase does NOT do

- Does not build `MODULE_REGISTRY` (confirmed never built, superseded by `CAPABILITY_REGISTRY` — see §6).
- Does not add a third business type (no new industry is launched by this phase — matches `00-vision.md` §4's explicit non-goal "does not pick Hotel by default").
- Does not drop `tenants.vertical` — retained indefinitely per ADR-01, revisited only after a deprecation window this phase does not start the clock on.
- Does not touch `phase-03-hr-payroll-pos-enforcement`'s scope, D1, or any file it plans to change.
- Does not enable RLS, touch billing, or modify the CRM/O2C split.
- Does not onboard Distribution/Manufacturing/Hotel/Healthcare — this is schema-only groundwork Phase 10 will eventually use, not Phase 10 itself.

## 8. Document map

| File                                         | Contents                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `01-current-code-evidence.md`                | The real `vertical` call sites (more than the architecture docs' "4 known" count — corrected here), current schema, migration state |
| `02-business-requirements.md`                | Why this phase is safe and low-risk relative to Phase 3                                                                             |
| `04-domain-model.md`                         | `industries`/`business_types`/`tenants.business_type_id` — exact shape, resolving D1                                                |
| `05-service-impact.md`                       | `apps/tenant-service` changes: `setTenantBusinessType()`, `TenantProvisioner`                                                       |
| `06-database-impact.md`                      | The migration itself — reference-table creation, FK, backfill                                                                       |
| `07-api-contracts.md`                        | `POST /admin/tenants`'s schema — confirms zero breaking change                                                                      |
| `08-permissions-and-rbac.md`                 | Confirms zero RBAC change                                                                                                           |
| `09-navigation-and-frontend.md`              | Confirms zero frontend change (this phase is backend/schema only)                                                                   |
| `10-entitlement-impact.md`                   | Confirms zero entitlement change                                                                                                    |
| `11-event-impact.md`                         | Confirms zero event change                                                                                                          |
| `12-reporting-impact.md`                     | Confirms zero reporting change                                                                                                      |
| `13-search-impact.md`                        | Confirms out of scope                                                                                                               |
| `14-ai-copilot-impact.md`                    | Confirms zero AI-surface change                                                                                                     |
| `15-security-impact.md`                      | Confirms zero new trust boundary                                                                                                    |
| `16-testing-strategy.md`                     | New coverage — this phase adds the _first_ dedicated `TenantProvisioner`/vertical test, none exists today                           |
| `17-migration-and-backward-compatibility.md` | Why this backfill is provably lossless                                                                                              |
| `18-observability.md`                        | Minimal — a migration-completion log line, no new metric                                                                            |
| `19-rollout-and-rollback.md`                 | Simple, additive-only rollback                                                                                                      |
| `20-acceptance-criteria.md`                  | Testable criteria                                                                                                                   |
| `21-file-level-change-plan.md`               | Concrete file list                                                                                                                  |
| `22-risk-register.md`                        | Led by the D1 naming decision and migration-number coordination with Phase 3                                                        |
| `23-executive-summary.md`                    | One-page summary                                                                                                                    |
| `24-pre-implementation-review.md`            | Gate — D1 must be answered first                                                                                                    |
| `25-decision-record.md`                      | D1 (module vs. capability naming) + D2 (migration sequencing vs. Phase 3)                                                           |
