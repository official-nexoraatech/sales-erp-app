# CRM Roadmap — Planning Kit

**Status:** Planning only. No implementation code has been written from this kit yet.
**Generated:** 2026-07-29
**Scope:** Everything needed to take the CRM module from its current state (Segments, Campaigns,
Loyalty ledger, Business Seasons, Health Scoring, Activity Timeline — see `00-CODEBASE-AUDIT.md`)
to a full lifecycle CRM (Lead → Pipeline → Customer 360 → Support → AI intelligence) without
breaking this codebase's existing architecture, conventions, or in-flight work.

This folder follows the same convention as the rest of `ERP-PLANNING/`: read the numbered docs in
order before starting any phase, and generate a completion report per phase using the existing
`ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md` when a phase ships.

---

## How to use this kit

1. **Read first, in order:** `00-CODEBASE-AUDIT.md` → `01-CRM-GAP-ANALYSIS.md` →
   `02-ARCHITECTURE-RECOMMENDATIONS.md`. These three establish ground truth and must not be
   skipped — the phase docs assume you already know what they say.
2. **Read the cross-cutting plans once, reference them per feature:** `03` through `09` cover
   database, API, UI/UX, security, performance, testing, and rollback/risk policy that apply to
   _every_ feature below, so they are not repeated in full inside each feature spec.
3. **Work one phase document at a time**, same rule as the rest of `ERP-PLANNING/`: one phase = one
   session, do not interleave. Each phase is independently shippable and testable — do not start
   Phase 2 features before Phase 1 is deployed and its completion report exists.
4. **Every feature spec is self-contained enough to implement without re-deriving intent** — that
   was the design goal. If something is ambiguous when you get there, that's a gap in this kit,
   not a signal to invent — stop and resolve it the way `ERP-PLANNING/README.md`'s "if Claude
   starts inventing architecture" section describes.

---

## Document index

| Doc                                                                        | Purpose                                                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`00-CODEBASE-AUDIT.md`](00-CODEBASE-AUDIT.md)                             | Current architecture, stack, conventions, what's real vs. stale in existing `ERP-PLANNING/` docs, technical debt inventory |
| [`01-CRM-GAP-ANALYSIS.md`](01-CRM-GAP-ANALYSIS.md)                         | What CRM capability exists today vs. what's missing, feature-by-feature                                                    |
| [`02-ARCHITECTURE-RECOMMENDATIONS.md`](02-ARCHITECTURE-RECOMMENDATIONS.md) | Structural decisions the roadmap depends on (new service vs. extend sales-service, event contracts, etc.)                  |
| [`03-DATABASE-MIGRATION-PLAN.md`](03-DATABASE-MIGRATION-PLAN.md)           | Every new table, migration sequencing, backward-compatibility rules                                                        |
| [`04-API-DESIGN-PLAN.md`](04-API-DESIGN-PLAN.md)                           | Route conventions, versioning, gateway wiring for new CRM endpoints                                                        |
| [`05-UI-UX-PLAN.md`](05-UI-UX-PLAN.md)                                     | Frontend information architecture, component reuse, new component needs                                                    |
| [`06-SECURITY-PLAN.md`](06-SECURITY-PLAN.md)                               | Permission constants, data sensitivity, new attack surface (portal, public APIs)                                           |
| [`07-PERFORMANCE-PLAN.md`](07-PERFORMANCE-PLAN.md)                         | Query/index strategy, caching, projection needs at CRM scale                                                               |
| [`08-TESTING-STRATEGY.md`](08-TESTING-STRATEGY.md)                         | Unit/integration/E2E/Playwright conventions and coverage gates for this roadmap                                            |
| [`09-ROLLBACK-AND-RISK.md`](09-ROLLBACK-AND-RISK.md)                       | Rollback strategy and risk register, cross-phase                                                                           |
| [`10-PHASE-1-FOUNDATION.md`](10-PHASE-1-FOUNDATION.md)                     | Phase 1 features, fully specced                                                                                            |
| [`11-PHASE-2-PIPELINE-ENGAGEMENT.md`](11-PHASE-2-PIPELINE-ENGAGEMENT.md)   | Phase 2 features, fully specced                                                                                            |
| [`12-PHASE-3-INTELLIGENCE.md`](12-PHASE-3-INTELLIGENCE.md)                 | Phase 3 features, fully specced                                                                                            |
| [`13-PHASE-4-ENTERPRISE.md`](13-PHASE-4-ENTERPRISE.md)                     | Enterprise-tier features, specced at lighter detail (lower near-term confidence)                                           |

---

## Non-negotiables inherited from the existing codebase

These are not re-derived per phase — they apply to every feature in this kit, full stop, because
violating them breaks conventions the rest of the ERP already depends on:

- Every new table gets `tenant_id`, `created_at`, `updated_at`; mutable tables get `version`
  (optimistic lock) — see `ERP-PLANNING/CODING_STANDARDS.md` §2–3.
- Every state-changing endpoint: Zod validation → `requirePermission()` → business logic → audit
  log → outbox event in the same transaction (never publish directly to Kafka).
- Every new permission constant goes in `packages/shared-types/src/permissions.ts` **and** its
  frontend mirror `apps/web-frontend/src/constants/permissions.ts`, added in the same change — see
  `RBAC_ARCHITECTURE.md` §4 for the exact bug class (four separate incidents) this prevents.
- No new backend framework, ORM, driver, or state library — `TECH_AUDIT.md` §2–3 lists what's
  installed; this roadmap builds features with what's already there (Fastify, Drizzle, Zod,
  TanStack Query, Zustand, react-hook-form).
- Every route needs a guard or it fails CI — `packages/shared-types/src/__tests__/route-guard-coverage.test.ts`
  enforces this automatically; do not add it to `KNOWN_EXCEPTIONS` without a documented reason.
- Prefer extending an existing service over creating a new one. Every feature spec below states
  explicitly which existing service/module it extends and why a new service is or isn't warranted.
