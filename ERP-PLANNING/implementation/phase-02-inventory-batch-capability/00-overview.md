# 00 — Phase 2 (Inventory Batch Capability): Overview

Status: Planning only. No code, migration, or config changed to produce this document set. Written 2026-08-18, immediately following Phase 1 (Capability Foundation)'s "VERIFIED WITH FOLLOW-UP" verdict.

---

## 1. What this phase is, in one sentence

Wire the Phase 1 capability-resolution mechanism (`CAPABILITY_REGISTRY`, `requireCapability()`, `isCapabilityEnabled()`) onto one real, currently-half-built, genuinely multi-industry-reusable feature — **batch/lot + expiry-aware (FEFO) inventory tracking** — completing its two missing plumbing pieces in the process, so the capability is real rather than a demo flag.

## 2. Relationship to the existing roadmap (read this before anything else)

This session's brief asks to evaluate Distribution/Manufacturing/Hotel/Hospital and pick "the first real capability." That is **not** the same question as `multi-industry-platform/16-phase-roadmap.md` Phase 10 ("First New Industry Vertical") — this phase deliberately does not answer "which industry ships next." It answers the narrower, prerequisite question `00-roadmap-analysis.md` already identified as the very next step after Phase 1: _"Phase 2 (future) — Wire `requireCapability` onto real HR/Production routes + tag real nav groups."_ This document set **is** that phase, scoped using evidence from the Distribution/Manufacturing candidate evaluation (§5 below) rather than picking HR/POS (Phase 1's own suggested starting point) — see §6 for why.

The Business Profile foundation (`industries`/`business_types` tables) and the CRM/O2C service split are **not** touched or required by this phase — confirmed independent per `00-roadmap-analysis.md` §B/§C. A real Phase 10 ("launch Distribution as a business type") still requires both of those first. This phase only proves the capability-gating mechanism against a real, reusable feature; it does not launch an industry.

## 3. Why not "just build Distribution" or "just build Manufacturing"

The governing brief for this session explicitly prohibits creating a new industry module, a migration for a new business type, or a complete vertical ERP. Full evaluation is in `02-business-requirements.md` and the final decision record in `23-executive-summary.md`; the short version: Distribution and Manufacturing are both **reuse-heavy, configuration-driven** business types (per `19-first-industry-recommendation.md`, corrected further by this phase's own code evidence — `01-current-code-evidence.md` §4) — neither needs a large amount of new domain code, both need the _same_ small set of Commerce Core capabilities (batch/lot tracking, multi-UOM, and for Distribution specifically, pricing-tier/credit-limit config that already exists). Picking either industry outright would mean building a `business_types` row and provisioning flow neither this phase's scope nor Phase 1's foundation is ready for. Picking the **capability those industries actually need first** — without committing to either — is the correct-sized next step, and is exactly what `19-first-industry-recommendation.md`'s own capability examples for Distribution list first: `BATCH_TRACKING`, `MULTI_UOM`.

## 4. The chosen capability: `INVENTORY_BATCH`

Batch/lot number + expiry-date tracking on inventory, with expiry-aware (FEFO) stock consumption ordering. Already partially built (migrations `0165_inventory_batch_expiry_fefo.sql`, `0166_purchase_unit_conversion.sql`, both dated 2026-08-16) but **currently unreachable and non-functional** — see `01-current-code-evidence.md` for the full evidence trail. This phase:

- Registers it as `CAPABILITY_REGISTRY['INVENTORY_BATCH']`, backed by a new flag key `inventory.batch.enabled`.
- Completes the two missing pieces that make it a real, working feature (item-level enablement API, expiry-aware consumption ordering).
- Wires `requireCapability`/`isCapabilityEnabled` onto real routes across three services (`inventory-service`, `purchase-service`, `sales-service`) — proving capability enforcement is not tied to one service boundary, directly validating `21-capability-resolution-architecture.md` §1's rule ("never infer service boundaries from the capability list").
- Tags one real frontend surface with `capabilityKey` (item batch/expiry config UI + a new Near-Expiry Stock nav entry) — the first real exercise of the `capabilityKey` field Phase 1 added but left unused everywhere.

## 5. Candidates evaluated (full detail: `02-business-requirements.md`)

Distribution, Manufacturing, Hotel, Hospital, and "generalize an existing domain first" were all evaluated against fresh repository evidence, not assumed maturity from `19-first-industry-recommendation.md`. One material correction was found: that document's claim that `production-service` has "BOM/routing concepts partially present" is **false** — direct grep of `permissions.ts` and `apps/production-service/src/domain/` found zero `BOM_`/`WORK_ORDER`/`MATERIAL_CONSUMPTION` constants and zero BOM/routing/work-center code; `production-service` is Job-Work/Consignment/Reorder/Barcode only. This _downgrades_ Manufacturing's readiness relative to the prior document's estimate and is carried through this plan's recommendation.

## 6. What this phase does NOT do (see `07-non-goals` folded into each doc's own scope note, consolidated in `23-executive-summary.md`)

- Does not build Distribution, Manufacturing, Hotel, or Hospital as an industry/business type.
- Does not touch `industries`/`business_types` tables (they don't exist yet — separate, parallel workstream).
- Does not touch the CRM/O2C split.
- Does not wire `requireCapability` onto `HR_PAYROLL` or `POS` (Phase 1's already-registered, already-tested capabilities) — deliberately deferred; see `23-executive-summary.md` §9 for why, and as a recommended fast-follow using the identical pattern this phase establishes.
- Does not build multi-UOM purchase-unit conversion end-to-end (schema exists from `0166`, but is a separate, independently-scoped capability — `MULTI_UOM` — not bundled here to keep this phase to one capability, per the brief's explicit "smallest meaningful capability" instruction).
- Does not enable RLS, touch billing, or modify the gateway.

## 7. Document map

| File                                         | Contents                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `01-current-code-evidence.md`                | What exists today, verified by direct code reading — the evidence this whole plan is built on |
| `02-business-requirements.md`                | Full Distribution/Manufacturing/Hotel/Hospital evaluation; why `INVENTORY_BATCH`              |
| `03-capability-definition.md`                | The `CAPABILITY_REGISTRY` entry, flag key, naming                                             |
| `04-domain-model.md`                         | Schema impact (none — already shipped)                                                        |
| `05-service-impact.md`                       | Exact files/functions changed across 3 services                                               |
| `06-database-impact.md`                      | The one new migration needed (flag seed + permission backfill)                                |
| `07-api-contracts.md`                        | Route-by-route contract changes                                                               |
| `08-permissions-and-rbac.md`                 | New permissions, role backfill (the "dead permission constant" risk)                          |
| `09-navigation-and-frontend.md`              | `capabilityKey` usage, new nav item, item-form UI                                             |
| `10-entitlement-impact.md`                   | How this fits the entitlement/flag bridge                                                     |
| `11-event-impact.md`                         | Confirms no new event types needed                                                            |
| `12-reporting-impact.md`                     | The new Near-Expiry read route — why not `report-service`                                     |
| `13-search-impact.md`                        | Confirms out of scope                                                                         |
| `14-ai-copilot-impact.md`                    | Inherited-for-free verification, one open check                                               |
| `15-security-impact.md`                      | The capability-granularity finding, defense-in-depth analysis                                 |
| `16-testing-strategy.md`                     | Test plan per changed file                                                                    |
| `17-migration-and-backward-compatibility.md` | Zero-behavior-change guarantee for existing tenants                                           |
| `18-observability.md`                        | Metrics/logging reused from Phase 1                                                           |
| `19-rollout-and-rollback.md`                 | Rollout sequencing, rollback per step                                                         |
| `20-acceptance-criteria.md`                  | Verifiable completion checklist                                                               |
| `21-file-level-change-plan.md`               | Every file touched, in implementation order                                                   |
| `22-risk-register.md`                        | Phase-specific risks                                                                          |
| `23-executive-summary.md`                    | The full decision record the brief's TENTH section requires                                   |
