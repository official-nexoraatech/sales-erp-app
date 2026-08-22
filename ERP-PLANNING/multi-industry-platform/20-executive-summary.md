# 20 — Executive Summary

Per the governing brief's §37 required structure. All claims cross-reference the evidence-based documents in this directory; nothing here is asserted without a citation trail in `01-current-state.md` or `02-gap-analysis.md`.

## A. Executive Summary

Nexoraa's platform layer (auth, tenancy, RBAC, events, feature flags, entitlements, search, gateway) is already substantially multi-industry-ready — it was proven by a no-fork Grocery rollout. What's missing is a thin **runtime gating layer** (module/capability-aware nav and route guards) on top of primitives that already exist and already work. This plan adds that layer additively, fixes two known structural risks (the sales-service God-service problem, and the fact that `vertical` is a 2-value union with no runtime effect), and recommends Distribution or Manufacturing — not Hotel — as the lowest-risk first validation industry.

## B. Current Architecture Assessment

17 backend services + 3 frontends, Fastify/Drizzle/Kafka/Postgres/Redis/Elasticsearch, JWT-per-service trust model, application-level tenant isolation, transactional outbox event architecture. Full detail: `01-current-state.md`.

## C. Architectural Strengths

- Tenant-as-root, no unnecessary Organization layer — already correct.
- JWT verification trust boundary is deliberately and correctly enforced end-to-end (no trusted headers).
- Feature-flag system (`PlatformFeatureFlags`) is production-grade: 2-tier cache, hot pub/sub invalidation — the exact primitive a module system needs, already built.
- Entitlement primitives (`plan_entitlements`, `BillingService`) already exist, further along than assumed by a stale internal planning doc.
- Event envelope already carries every governance field (tenantId/correlationId/causationId/schemaVersion) the brief asks for.
- Search isolation is physical (index-per-tenant), not filter-based — strong by construction.
- AI Copilot is already correctly scoped through the caller's own JWT — no independent authorization gap.
- Financial reporting engine duplication (a real, previously-diverged bug) was already found and fixed 2026-08-16.
- CI/CD is enterprise-grade (per prior architecture audit): 80% coverage gate, SAST/Trivy/TruffleHog/Snyk, staged K8s deploy with auto-rollback.

## D. Architectural Weaknesses

- No runtime module/capability gating — `vertical` only affects provisioning-time seeding (G1).
- `tenants.vertical` is a hardcoded 2-value TS union with no Industry/BusinessType hierarchy (G2).
- sales-service hosts both Order-to-Cash and the entire CRM roadmap in one deployable; the split is scaffolded but not executed (G3).
- RBAC has no formal module association beyond an informal naming convention (G4).
- Navigation has no capability-awareness (G5).
- Batch/expiry tracking and UOM conversion are missing Commerce Core primitives, blocking Grocery maturity and most future verticals (G8).
- Postgres RLS designed but not enabled; tenant isolation has no DB-level backstop (G7).

## E. Critical Risks

Sales-service split deprioritization (R1), RLS enabled prematurely by a future session without the GUC fix (R4), a new industry built before Commerce Core generalization if it needs batch/expiry (R5). Full register: `17-risk-register.md`.

## F. Target Architecture

`Tenant → Business Profile (Industry × Business Type × Regulatory Pack) → Enabled Modules (feature-flag-backed) → Role → Permission × Module-check → Navigation/API`. Full detail: `03-target-architecture.md`.

## G. Capability Model

Module = named bundle of required feature-flag keys + permission prefixes + nav groups, defined in code (`MODULE_REGISTRY`), mirroring the existing `ROLE_DEFAULTS` code-template pattern. No new capability-level table in v1. Full detail: `05-module-capability-model.md`, `04-domain-model.md`.

## H. Entitlement Model

Entitlement (plan), module-enablement, and feature-flag remain three distinct _questions_ but share the existing `feature_flags` storage/cache mechanism for the boolean slice — already how PG-027 works today. Numeric entitlements (seats/branches) stay separate. Full detail: `06-entitlement-model.md`.

## I. RBAC Model

RESOURCE_ACTION naming unchanged. Module association added as pure metadata (prefix-derived map), not a rename. `requireModule()` and `requirePermission()` remain independent, ordered checks. Full detail: `07-rbac-model.md`.

## J. Navigation Model

Static `navigation.ts` gains one additive `moduleCode` field and filter predicate; no backend navigation service. Full detail: `08-navigation-model.md`.

## K. Configuration Model

No new subsystem — existing `tenants.settings`/`organization_settings`/`feature_flags` layering already covers the brief's configuration requirements; new `business_types` reference data is the only addition. Full detail: `09-configuration-model.md`.

## L. Domain Ownership Model

One aggregate, one owning service — already the enforced pattern, applies unchanged to future industry aggregates. Full detail: `01-current-state.md` §9, ADR-08 in `18-decisions.md`.

## M. Event Architecture

Mechanism already sound (outbox, DLQ, schema registry, saga orchestrator, full envelope). This phase's work is documentation (write down the implicit convention) plus, separately, pulling forward Commerce Core generalization (batch/expiry/UOM) as real engineering. Full detail: `10-event-architecture.md`.

## N. Reporting Architecture

Existing direct-DB/replica reporting stays as-is (working, already deduplicated). New industry-specific analytical needs should prefer event-fed projections over more direct cross-schema coupling. Full detail: `11-reporting-architecture.md`.

## O. Security / Tenant Isolation Strategy

JWT/gateway trust boundary preserved exactly. RLS sequenced as an independent hardening track (GUC fix first, then table-by-table rollout), not a prerequisite for multi-industry work. Full detail: `13-security-architecture.md`, ADR-06/ADR-07.

## P. Migration Strategy

Fully additive/incremental; `tenants.vertical` retained and synced, never dropped in this plan; every phase independently revertible. Full detail: `15-migration-strategy.md`.

## Q. Detailed Phase Roadmap

12 phases, reordered against actual dependencies (CRM/O2C split and Commerce Core generalization pulled forward, ahead of Phase 10 rather than after it). Full detail: `16-phase-roadmap.md`.

## R. First Industry Recommendation

**Distribution** (lowest risk, validates the pipeline) or **Manufacturing** (extends an existing but gap-flagged service, tests multi-module composition) — not Hotel or Healthcare, which have the least code reuse and highest domain/regulatory complexity of all candidates evaluated. Full detail: `19-first-industry-recommendation.md`. This is a recommendation for user confirmation, not a final decision.

## S. Risk Register

9 risks identified, all traceable to already-documented gaps or process risk (deprioritization, drift) rather than target-model design flaws. Full detail: `17-risk-register.md`.

## T. ADR Index

9 ADRs, 6 Confirmed (continuity of already-correct decisions), 3 Proposed (new work requiring execution). Full detail: `18-decisions.md`.

## U. Open Questions (for the user/product owner)

1. Confirm the first-industry choice (Distribution vs. Manufacturing vs. a business-priority-driven alternative not purely reuse-optimized) — `19-first-industry-recommendation.md`.
2. Confirm whether the CRM/O2C split should be resourced now, in parallel with Business Profile work, or deferred — it's currently scaffolded-but-idle and is this plan's single largest dependency risk (R1).
3. Confirm timeline appetite for Commerce Core generalization (Phase 7, batch/expiry+UOM) — it's needed for Grocery today independent of any new industry, and blocks Bakery/Restaurant/Pharmacy-shaped future verticals.
4. Confirm whether RLS hardening (Phase 9) should be scheduled now or deferred further — no urgency from this plan, but tenant/service count keeps growing.
5. Confirm PG-012 (tenant suspension enforcement, currently a no-op) and PG-027 Sessions 2-3 (billing) ownership/timeline — referenced but explicitly out of scope here.

## V. Recommended Next Action

Do not start implementation from this document set directly. Next step: a short alignment session with the user covering the 5 open questions above (§U), followed by scoping Phase 1 (Business Profile Foundation) as its own dedicated implementation session per this repo's established one-phase-one-session convention (`ERP-PLANNING/README.md`).

**Addendum:** `21-capability-resolution-architecture.md` was added after a structured review of this document set. It resolves the one mechanism this summary left implicit — how capability checks are actually enforced (per-service, via a new `requireCapability()` platform-sdk guard, never gateway-only) — and collapses the Module/Capability terminology split used in docs 04/05/07/08 into one flat `CAPABILITY_REGISTRY`. Read it before Phase 1 begins; it is the actual sign-off gate the review recommended in place of jumping straight to implementation.
