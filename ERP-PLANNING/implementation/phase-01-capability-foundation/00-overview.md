# Phase 1 — Capability Foundation: Overview

## What this phase is

Builds the **capability-resolution mechanism** described in `ERP-PLANNING/multi-industry-platform/21-capability-resolution-architecture.md` — a code-defined capability registry, a `requireCapability()` platform-sdk guard mirroring the existing `requirePermission()` exactly, the `CAPABILITY_NOT_ENABLED` error contract, and a frontend capability-delivery path — proven against **two real, already-existing feature flags** (`hr.payroll.enabled`, `pos.enabled`), per the architectural-discipline rule "every new abstraction must have evidence from at least two real consumers when practical" (`21-capability-resolution-architecture.md` reference; source instruction §25.12).

## What this phase is NOT

- Not a database migration — zero schema change (see `10-database-and-migrations.md` for why).
- Not the Business Profile (`industries`/`business_types`) work — that's an independent, parallel workstream, only needed before Phase 10 (`00-roadmap-analysis.md` §B/§H.1).
- Not wiring `requireCapability` onto any real HR/Production/other route — this phase proves the mechanism in isolation and via tests; real route wiring is the next phase (`00-roadmap-analysis.md`'s renumbering table).
- Not tagging any real navigation group with a `capabilityKey` — the frontend mechanism is built and tested, not yet applied to `NAV_GROUPS`.
- Not billing/payment-gateway work, not RLS, not the CRM/O2C split.

## Why this scope (evidence-based, not arbitrary)

Verified this session: `PlatformFeatureFlags.getValue()`/`isEnabled()` (`packages/platform-sdk/src/feature-flags.ts`) resolves purely from the `feature_flags` table, scoped by `tenantId` — no dependency on any Business Profile table. Every current tenant already has real `feature_flags` rows. This means the capability mechanism can be built, tested, and proven correct **today**, against real data, with zero migration and zero risk to any existing tenant — the safest possible Phase 1.

## Success criteria

1. `requireCapability('HR_PAYROLL')` and `requireCapability('POS')` resolve correctly (true/false) against a real tenant's `feature_flags` state in an integration test — no route depends on this yet, but the mechanism is provably correct.
2. A capability-disabled request produces a distinguishable `CAPABILITY_NOT_ENABLED` response, verified by a route-level test mirroring `tenant-admin-authz.test.ts`'s exact pattern.
3. Frontend capability delivery mechanism exists and is tested, without yet being wired to any real nav group (avoids the blast-radius risk documented in `08-frontend-navigation.md` §5 — 310 `hasPermission()` call sites across 139 files means any change to the auth payload shape needs to be proven safe in isolation first).
4. Zero behavior change for any existing route, tenant, or frontend page — confirmed by running the full existing test suite unmodified and green.

## Reading order

`01-current-code-evidence.md` (the exact code this phase builds on) → `02-capability-model.md` → `03-capability-registry.md` → `04-capability-resolution.md` → `05-platform-sdk.md` → `06-service-enforcement.md` → `07-entitlement-integration.md` → `08-frontend-navigation.md` → `09-ai-copilot-impact.md` → `10-database-and-migrations.md` → `11-api-contracts.md` → `12-testing-strategy.md` → `13-migration-and-backward-compatibility.md` → `14-observability-and-audit.md` → `15-rollout-and-rollback.md` → `16-acceptance-criteria.md` → `17-file-level-change-plan.md` (the executable checklist).

## Architectural decisions — RESOLVED 2026-08-18

All four decisions below were approved by the architect after the pre-implementation gate review (`18-pre-implementation-review.md`). No open approval gate remains.

1. **How `enabledCapabilities` reaches the frontend** — DECIDED: extend the existing `authApi.me()` bootstrap call (`GET /users/me`, `apps/auth-service/src/routes/users.ts:551`), not the JWT. See `08-frontend-navigation.md` §2.
2. **Error contract** — DECIDED: `CAPABILITY_NOT_ENABLED` and `PERMISSION_DENIED` both use HTTP 403. See `11-api-contracts.md` §2 (including an honest discrepancy note against today's live `FORBIDDEN` code string, not silently reconciled).
3. **Pre-existing hardening risks found during the gate review** (`BillingService` transaction safety, `PlatformFeatureFlags` cache race) — DECIDED: out of Phase 1 scope, tracked separately in `19-deferred-hardening-risks.md`.
4. **Fail-closed guarantee** — DECIDED: capability resolution errors (not just a clean `false`) must also deny access via an explicit `try/catch` in `requireCapability`, never propagate as a 500. See `04-capability-resolution.md` §5, `05-platform-sdk.md` §2.

Registering only the 2 proof-of-concept capabilities in this phase (`03-capability-registry.md` §4) remains a plan recommendation, not something requiring separate architect approval — unchanged.
