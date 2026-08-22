# 00 — Roadmap Analysis: Converting the 12-Phase Plan into Implementation-Ready Phases

Source: `ERP-PLANNING/multi-industry-platform/16-phase-roadmap.md`, `17-risk-register.md`, `18-decisions.md`, `19-first-industry-recommendation.md`, `20-executive-summary.md`, `21-capability-resolution-architecture.md`. This is analysis only — the source roadmap document is not rewritten; recommended changes are reported here for approval, per the governing instruction.

## A. Current roadmap summary

12 phases + one parallel track (CRM/O2C service split), originally sequenced: Phase 0 (discovery, done) → Phases 1–5 (Business Profile DB → Capability Registry → inert guard → RBAC/nav wiring on HR+Production → capability-aware nav) → Phases 6–9 (docs + Commerce Core generalization + reporting/search hardening + RLS hardening, all flagged independent) → Phase 10 (first new industry) → Phase 11 (billing, separate track) → Phase 12 (review checkpoint). Doc 21 (written after a structured review of docs 00–20) then collapsed the two-tier Module/Capability vocabulary used in Phases 2–5 into one flat `CAPABILITY_REGISTRY`/`requireCapability()` model, without renumbering the roadmap itself.

## B. Phase dependency graph (as originally drawn vs. as evidence now shows)

**As originally drawn** (`16-phase-roadmap.md`):

```
Phase 1 (Business Profile DB) → Phase 2 (Registry) → Phase 3 (inert guard) → Phase 4 (wire HR/Production) → Phase 5 (nav)
```

**As evidence now shows** (verified 2026-08-18 against real code — `packages/platform-sdk/src/feature-flags.ts`, `BillingService.ts`, `TenantProvisioner.ts`): capability resolution at runtime (`getValue()`/`isEnabled()` on `PlatformFeatureFlags`) reads only `feature_flags` rows, scoped by `tenantId`. It has **zero dependency on `tenants.business_type_id` or the `business_types`/`industries` tables** — those tables only matter for _seeding new tenants' default flags at provisioning_ (`TenantProvisioner.ts:242`, `seedFeatureFlags`). Every currently-existing tenant already has real `feature_flags` rows today, with or without a `business_type_id` column existing.

```
Phase 1 (Business Profile DB)  ─────────────────┐  (needed only for Phase 10's NEW business types,
                                                  │   not for capability enforcement on existing tenants)
Phase 2 (Registry) → Phase 3 (guard) → Phase 4 (wire routes) → Phase 5 (nav)
```

**This is the single most important correction this analysis makes**: Phase 1 (Business Profile DB) and Phases 2–5 (Capability Registry through nav) are **independent tracks, not a sequential chain**. Phases 2–5 can ship, be tested, and even partially roll out against today's existing `CLOTH_RETAIL`/`GROCERY` tenants with zero schema migration, because those tenants' `feature_flags` already exist and already work.

## C. Foundational phases

Phases 2–3 (Capability Registry + guard mechanism) are the true foundation — every later phase (4, 5, 10) depends on them existing. Phase 1 (Business Profile DB) is foundational **only for Phase 10**, not for Phases 2–5.

## D. Shared ERP capability work (not industry-specific)

Phase 7 (Commerce Core generalization — batch/expiry, UOM) — **status corrected this session**: substantially already shipped (migrations `0165`–`0168`, real code in `GRNService.ts`/`PromotionService.ts`/`DayEndSettlementService.ts`/`nearExpiryAlert.job.ts`, see `02-gap-analysis.md` G8's correction note). Remaining scope shrinks to: verify FEFO consumption-order end-to-end, re-check inventory/purchase/production stock-mutation triplication status, write `EVENT_GOVERNANCE.md`. Phase 6 (config docs), Phase 8 (reporting/search docs), Phase 9 (RLS/security hardening) remain open, independent, non-blocking.

## E. Actual industry expansion

Only Phase 10 (first new industry). The CRM/O2C service split (parallel track) is _enabling_ work for Phase 10, not itself industry expansion — sales-service needs to not keep growing before a new industry adds more weight to it (`02-gap-analysis.md` G3).

## F. Phases that can run in parallel

Phase 1 (Business Profile DB) ∥ Phases 2–5 (per §B's correction) ∥ Phase 6 (docs) ∥ Phase 7 remainder (FEFO verification, event-governance doc) ∥ Phase 8 (docs) ∥ Phase 9 (GUC fix, independent security track) ∥ CRM/O2C split (parallel track, already established in the source roadmap).

## G. Phases that must be sequential

Within the capability track: Registry (2) → Guard (3) → Route wiring (4) → Nav (5) — each genuinely depends on the previous existing and being tested. Phase 10 depends on: Phases 2–5 complete (capability pipeline proven) AND Phase 1 complete (a new business type needs a `business_types` row to seed from) AND the CRM/O2C split far enough along that the new industry doesn't add to sales-service's God-service problem.

## H. Roadmap ordering problems found

1. **Phase 1 was drawn as a hard prerequisite to Phase 2 with no evidence for that dependency** (§B). Recommended fix: decouple — Phase 1 becomes its own parallel workstream, tracked but not blocking.
2. **Phase 7's scope is now substantially smaller than originally planned** — the G8 correction (`02-gap-analysis.md`) means this session's evidence found real, already-shipped code that the original roadmap assumed was still a gap. Recommended fix: re-scope Phase 7 to (a) FEFO consumption-order verification, (b) stock-mutation triplication re-check, (c) `EVENT_GOVERNANCE.md` — each much smaller than "build batch/expiry/UOM from scratch."
3. **Terminology drift between Phases 2–5 (source roadmap, "Module"/`MODULE_REGISTRY`/`requireModule`) and doc 21 (flat `CAPABILITY_REGISTRY`/`requireCapability`, written later after a review).** The source roadmap document itself was not updated when doc 21 superseded this vocabulary. Recommended fix: this implementation plan (Phase 1 — Capability Foundation, below) uses doc 21's vocabulary throughout; `16-phase-roadmap.md` should be updated to match in a follow-up edit (not done in this planning-only session per the "do not modify existing docs beyond what's asked" instruction — flagged here instead).
4. **No admin route exists yet to change a tenant's plan post-provisioning** (`BillingService.assignPlanEntitlements` has exactly one call site, `TenantProvisioner.ts:242`; grep confirmed no `PATCH .../plan` route exists). This means "propagate an entitlement change to a running tenant's capability set" is currently a _theoretical_ problem, not one that needs new cache-invalidation machinery in Phase 1 — there is no code path that changes a live tenant's plan today. Recommended fix: Phase 1's scope explicitly does not build entitlement-change propagation; it documents that the existing `PlatformFeatureFlags.invalidate()`/Redis-pub/sub mechanism (already used by `auth-service`'s `PUT /admin/feature-flags/:name` route) already covers _ops-driven_ flag toggles, which is the only live propagation path today.
5. **Frontend capability delivery is not as simple as "extend the endpoint that supplies `permissions[]`"** (doc 08/21's original phrasing) — verified that `permissions[]`/`roles[]` are decoded **client-side from the raw JWT** (`atob(accessToken.split('.')[1])`, `LoginPage.tsx:157-170`, `api/client.ts:89-118`), not fetched from a `/me`-style endpoint for that specific data. There IS a real `authApi.me()` call already made at login (for profile/branch fields) that could be extended. This is a genuine **ARCHITECTURAL DECISION REQUIRED** — see `phase-01-capability-foundation/08-frontend-navigation.md` §2 for the two options and recommendation.

## I. Phases that should be split

- **Phase 1 (Business Profile DB)** splits off from the Capability track entirely (§H.1) — becomes a parallel, Phase-10-scoped-only workstream, not part of Phase 1's implementation plan below.
- **Phase 7** splits into three independently-trackable, much-smaller items per §H.2.

## J. Phases that should be merged

- **Phase 4 (route wiring) and Phase 5 (nav)** are tightly coupled in practice — both consume the same "effective capability set" concept and should be delivered as one rollout unit once Phase 1 (this session's Capability Foundation) is validated, rather than two fully separate roadmap phases. Not executed in this session (out of scope — Phase 1 here is the _mechanism_, not the _rollout_), but recommended for the next roadmap revision.

## Recommended phase renumbering for implementation purposes (this session only — source roadmap unchanged)

| This session calls it                                   | Corresponds to source roadmap                                  | Scope                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1 — Capability Foundation** (detailed below)    | Phases 2–3 + the error-contract/frontend-delivery slice of 4–5 | `CAPABILITY_REGISTRY`, `requireCapability()`, resolution semantics, error contract, frontend capability-delivery mechanism (not yet wired to real nav groups), AI Copilot impact verification. Zero DB migration. Inert/shadow — no real route enforces anything yet. |
| Business Profile workstream (not detailed this session) | Source roadmap Phase 1                                         | `industries`/`business_types` tables — proceeds independently, required only before Phase 10                                                                                                                                                                          |
| Phase 2 (future)                                        | Source roadmap Phase 4 + 5, merged per §J                      | Wire `requireCapability` onto real HR/Production routes + tag real nav groups — only after Phase 1 (this session) is validated                                                                                                                                        |
| Phase 3 (future)                                        | Source roadmap Phase 7 (re-scoped, §H.2)                       | FEFO verification, stock-mutation triplication re-check, `EVENT_GOVERNANCE.md`                                                                                                                                                                                        |
| Phases 4+ (future)                                      | Source roadmap Phases 6, 8, 9, 10, 11, 12                      | Unchanged in substance, sequencing per source roadmap §G above                                                                                                                                                                                                        |
