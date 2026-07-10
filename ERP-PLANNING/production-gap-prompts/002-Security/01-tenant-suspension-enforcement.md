# [PG-012] Tenant Suspension/Closure Enforcement

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** Critical
**Complexity:** S — the middleware already exists and is exported; the work is registering it correctly in 13 services (api-gateway excluded, see PG-001) plus tests proving it can't silently regress again
**Depends on:** none
**Blocks:** PG-027 (billing-driven suspension is meaningless without real enforcement underneath it)
**Primary service(s)/package(s):** apps/tenant-service/src/middleware/tenantContext.ts, apps/tenant-service/src/main.ts, and the equivalent request-pipeline entrypoint of every other backend service

---

## Overview

- **Business objective:** a tenant that has been suspended (non-payment, policy violation, offboarding) or closed (churned) must not be usable. Today it still is — every user of a suspended/closed tenant can log in and use the full application exactly as before. This is a live, silent gap between what admins believe happens when they click "Suspend" and what actually happens.
- **Current implementation:** `apps/tenant-service/src/middleware/tenantContext.ts` fully implements `createTenantContextMiddleware(db: ErpDatabase): FastifyPluginCallback` — it looks up the tenant's status (with a 60-second in-memory cache, `tenantStatusCache`/`CACHE_TTL_MS`) and is written to reject requests from `SUSPENDED`/`CLOSED` tenants. It is re-exported from `apps/tenant-service/src/main.ts:100` (`export { createTenantContextMiddleware } from './middleware/tenantContext.js';`) — exported for other services to import, but never actually registered as a `fastify.register(...)` call anywhere, including in tenant-service's own `main.ts`.
- **Current architecture:** every service authenticates via its own `authenticate` middleware (RS256 JWT verify) and authorizes via `requirePermission()`; tenant-status enforcement was designed as a third, separate layer sitting logically between those two, keyed off `tenantId` from the verified JWT — but that layer was never wired into any service's plugin registration chain.
- **Current limitations:** confirmed via `ERP-PLANNING/phase-completions/ES-21_COMPLETION.md`: *"`createTenantContextMiddleware` (tenant-service) remains exported but never registered in `main.ts` — noted during pre-flight reading, **not** one of this phase's 8 findings, left untouched."* This is a deliberate, tracked, still-open deferral, not an oversight discovered for the first time here.

## Existing Code Analysis

- **What already exists and should be reused:** `createTenantContextMiddleware` itself — its status-lookup query, its 60s cache, and its rejection logic are already correct and tested in isolation (per ES-21's own pre-flight notes). This package is a wiring/registration task, not a rewrite. Do not rewrite the middleware's internals unless the verification step below finds an actual bug in it.
- **What should never be modified:** the existing `authenticate`/`requirePermission()` chain in each service. Tenant-status enforcement is additive — it runs alongside, not instead of, JWT/permission checks.
- **Prior related work:** `ERP-PLANNING/audit-phase-prompts/ES-21-SECURITY-TENANT-USER-AUTHZ-LOCKDOWN.md` explicitly told that phase's implementer to read `tenantContext.ts` and `main.ts` and confirm the registration gap, then explicitly left it untouched (its 8 findings were elsewhere — cross-check `ES-21_COMPLETION.md`'s full findings list so this package doesn't duplicate anything ES-21 actually did fix). `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §4.3/§8 documents this as the same still-open gap as of 2026-07-08.

## Architecture

- No new architecture — this is completing a design that already exists. The middleware becomes a `preHandler` (or a plugin registered before route registration, matching however `authenticate` itself is wired in each service — check the exact pattern per-service, since registration style may differ slightly service to service) that runs immediately after JWT verification (it needs `request.auth.tenantId`, which `authenticate` populates) and before `requirePermission()` (no point checking permissions for a tenant that shouldn't be in the system at all).
- **Order of operations per request:** `authenticate` (JWT verify, populates `request.auth`) → `createTenantContextMiddleware` (tenant status check) → `requirePermission(X)` (route-specific authorization) → route handler.
- **What a blocked user sees:** a `403` with a distinct error code (e.g. `TENANT_SUSPENDED` / `TENANT_CLOSED`) rather than a generic `401`/`403`, so both frontends can render a clear "your organization's access has been suspended — contact your administrator" message instead of a confusing permission-denied screen. Confirm the exact response shape by reading the middleware's current implementation before finalizing this — it may already produce this distinction.
- **Cache correctness:** the existing 60-second `tenantStatusCache` means a just-suspended tenant's users could still get through for up to 60s after suspension — acceptable for this package (document it as a known, bounded staleness window) rather than switching to a per-request DB hit, which would add latency to every single request across all services for a rare admin action. If the business requires instant cutoff, that's a follow-up decision to flag to the user, not something to silently build in scope-creep fashion here.

## Database Changes

Not applicable — the tenant `status` column and its SUSPENDED/CLOSED values already exist (tenant-service's suspend/activate/close lifecycle already writes to it); no schema change needed.

## Backend

- **Register the middleware in every one of the 13 non-gateway services** (`auth-service`, `sales-service`, `purchase-service`, `inventory-service`, `production-service`, `accounting-service`, `gst-service`, `hr-service`, `event-service`, `notification-service`, `scheduler-service`, `search-service`, `report-service`, and `tenant-service` itself — 14 total, api-gateway is still a stub per PG-001 so skip it here and note it as a PG-001 follow-up item instead). Each service's `main.ts` needs one `fastify.register(createTenantContextMiddleware(db), ...)` call (or equivalent) placed after auth registration and before route registration — read each service's existing plugin-registration order in `main.ts` before adding, to slot it in correctly rather than assuming they're all identical.
- **Cross-service import:** since the middleware currently lives in `apps/tenant-service/src`, every other service importing it needs a real dependency path. Check whether tenant-service publishes anything consumable by other services today (it doesn't appear to, based on the current structure) — the pragmatic fix is to move `createTenantContextMiddleware` (and its status-lookup query) into a shared location, most likely `packages/platform-sdk` (`@erp/sdk`) alongside the other cross-cutting middleware helpers already living there, and have tenant-service itself import it from there too (single source of truth, no service-to-service source dependency). This is a larger structural decision than "just register it" — flag it explicitly as part of this package's actual scope, not an afterthought.
- **Auth/exemption exceptions:** login, refresh-token, and health-check routes must stay reachable regardless of tenant status (a suspended tenant's admin still needs to be able to see an informative message, and the refresh flow shouldn't hard-fail confusingly) — confirm the middleware already has an exemption list, or add one, mirroring how `authenticate` already exempts login/refresh/health routes in each service.
- **Telemetry:** add a `prom-client` counter `erp_tenant_blocked_requests_total{tenantId,status}` so blocked-tenant traffic is visible in the dashboards already wired for the `erp*` metric family, and an audit-log entry is not needed per-request (would be excessive) but the suspend/activate/close *action itself* is already audit-logged in tenant-service — confirm that stays true, don't duplicate it here.

## Frontend

- `web-frontend` and `pos-frontend`: add handling for the new `TENANT_SUSPENDED`/`TENANT_CLOSED` (or whatever exact codes the middleware returns) error response — both frontends already have a central API error-handling path (`apiClient` in web-frontend, its POS equivalent) that should intercept this specific code and redirect to a full-page "access suspended" screen rather than showing a generic toast, since every subsequent request will fail identically for the rest of the session.

## API Contract

- No new endpoints. Existing endpoints across all 14 services gain a new possible response: `403 { error: { code: 'TENANT_SUSPENDED' | 'TENANT_CLOSED', message: string } }` (confirm/align the exact code names with whatever the existing middleware implementation already emits).

## Multi-Tenant Considerations

- This IS the tenant-isolation enforcement mechanism for the lifecycle dimension (as opposed to the `tenant_id`-scoping dimension, which is unaffected and already correct). No feature-flag gating needed — this should apply unconditionally to every tenant, since a suspended tenant should never have a code path that still works.

## Integration

- Touches all 13 non-gateway backend services identically (same registration pattern). No event/Kafka involvement — this is a synchronous request-path check, not an async workflow.

## Coding Standards

- Reuses the existing middleware pattern (Fastify plugin registered via `fastify.register`), matching how `authenticate` is already wired in every service. If the middleware relocates to `@erp/sdk` (recommended above), that matches the existing convention of cross-cutting concerns living in the shared platform SDK rather than being duplicated or cross-imported service-to-service.

## Performance

- The existing 60-second in-memory cache already bounds the added latency to effectively zero for the overwhelming majority of requests (cache hits). Confirm the cache is per-service-process (not shared via Redis) — if so, note that a multi-replica deployment means each replica independently caches for up to 60s, which is an acceptable staleness bound, not a correctness bug, given tenant suspension is a rare, deliberate admin action, not a hot path.

## Security

- This closes a real, exploitable-today gap: a suspended or closed tenant is not actually locked out. Directly relevant OWASP category: API1:2023 (Broken Object Level Authorization) at the tenant-lifecycle level, and a business-logic-abuse risk if a tenant is suspended specifically for suspected fraud/abuse and continues operating undetected.
- No new permission constants needed — this is not permission-gated, it's a blanket tenant-level circuit breaker independent of user role.

## Testing

- New test in each service's existing test suite pattern (e.g. `apps/sales-service/src/__tests__/tenant-suspension.test.ts` mirrored across services, or one shared test helper in `@erp/sdk` if the middleware relocates there) — cases: `ACTIVE` tenant passes through; `SUSPENDED` tenant gets `403 TENANT_SUSPENDED`; `CLOSED` tenant gets `403 TENANT_CLOSED`; login/refresh/health routes remain reachable regardless of status; cache TTL expiry re-checks status (mock the clock).
- Regression guard: a repo-wide grep-based CI check (or a single integration test spinning up each service and hitting a protected route with a suspended tenant's token) that fails loudly if any service's `main.ts` stops registering the middleware — this exact regression already happened once (per ES-21's notes finding it unregistered), so a structural test that can't silently bit-rot again is worth the small extra effort.

## Acceptance Criteria

- [ ] `createTenantContextMiddleware` (or its `@erp/sdk`-relocated equivalent) is registered in all 13 non-gateway services' request pipelines, after auth and before permission checks.
- [ ] A request from a user whose tenant is `SUSPENDED` receives `403` with a distinct, frontend-handleable error code, on every one of the 13 services — verified by an integration test per service or one shared cross-service test.
- [ ] Login, refresh-token, and health-check routes remain reachable for suspended/closed tenants.
- [ ] Both frontends show a clear "access suspended" screen instead of a generic error toast when this response is received.
- [ ] A CI-enforced regression test fails the build if the middleware registration is ever removed from any service again.

## Deliverables

- **Files to create:** per-service test files (or one shared test if relocated to `@erp/sdk`); if relocating, `packages/platform-sdk/src/middleware/tenantContext.ts` (moved from tenant-service) plus its own test file.
- **Files to modify:** `main.ts` in all 13 non-gateway services (add registration call); `apps/tenant-service/src/main.ts` (register locally too, and update its re-export if the middleware relocates); `web-frontend`'s central API error handler + a new suspended/closed full-page view; `pos-frontend`'s equivalent.
- **Migrations:** none.
- **APIs added/changed:** no new endpoints; existing endpoints across 13 services gain a new `403` response case.
- **Events added/changed:** none.
- **Tests added:** tenant-suspension enforcement test(s), one per service or one shared, plus a CI regression guard.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `createTenantContextMiddleware` was written, presumably during the original tenant-service build-out, fully implements suspended/closed rejection with a 60s status cache, and is exported from `apps/tenant-service/src/main.ts`. ES-21 (a later security-hardening phase) explicitly noticed it was never registered anywhere, explicitly declined to fix it (out of that phase's scope), and left a note in `ES-21_COMPLETION.md` flagging it as still open. `FEATURE_INVENTORY.md` (2026-07-08) confirms it's still open as of that audit.

**Current Objective:** register the existing middleware in all 13 non-gateway services' request pipelines (auth → tenant-status → permission), so suspended/closed tenants are actually locked out, without breaking login/refresh/health routes or duplicating the existing JWT/permission layers.

**Architecture Snapshot:** 14 backend services, each with its own `authenticate` + `requirePermission()` middleware chain already correctly wired; tenant status (`ACTIVE`/`SUSPENDED`/`CLOSED`) already exists as a column and is already correctly written by tenant-service's suspend/activate/close routes — only the *read-and-enforce* side is missing.

**Completed Components:** the middleware implementation itself; the suspend/activate/close write-side lifecycle in tenant-service; ES-21's broader RBAC/tenant-authz hardening (see its completion report for what it DID fix, to avoid re-touching that).

**Pending Components:** PG-027 (billing-driven suspension) explicitly depends on this landing first — do not let that package get built against a still-unenforced suspension state.

**Known Constraints:** single shared Postgres, `tenant_id`-scoped tables, no RLS — irrelevant here since this is a request-path check, not a query-filtering concern. No live DB was available during some past sessions (ES-22–ES-24 per project history) — confirm a DB is reachable before writing/running the new tests, since this package's tests need one.

**Coding Standards:** Fastify plugin registration pattern, matching `authenticate`'s existing wiring per service; if relocated, follows `@erp/sdk`'s existing structure for shared middleware.

**Reusable Components:** `createTenantContextMiddleware` (`apps/tenant-service/src/middleware/tenantContext.ts`) — reuse as-is unless verification finds a real bug in it.

**APIs Already Available:** tenant status is already readable via whatever internal query the middleware already uses — no new API needed.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/logger`, `@erp/sdk` (target relocation location).

**Feature Flags:** not applicable — this is unconditional for all tenants.

**Multi-Tenant Rules:** this package IS the tenant-lifecycle enforcement rule; it does not touch the separate `tenant_id`-scoping-on-every-query rule, which is unaffected.

**Security Rules:** no permission constant involved — this runs regardless of the requesting user's role.

**Database State:** no migration needed; `status` column already exists and is already correctly maintained.

**Testing Status:** the middleware itself may have isolated unit tests already (verify) but zero integration tests exist proving it's actually wired into any service's live request pipeline — that's exactly the gap this package closes.

**Next Session Plan:** single session is feasible given Complexity S, but if split: session A does the `@erp/sdk` relocation + registration in tenant-service + its own tests; session B rolls the same registration pattern out to the remaining 12 services + the CI regression guard; session C does the two frontends' suspended/closed UI handling.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/01-tenant-suspension-enforcement.md` (PG-012). Before starting, re-read `apps/tenant-service/src/middleware/tenantContext.ts` in full to confirm its current exemption list and response shape, and re-confirm via grep that it is still unregistered in every service's `main.ts` (concurrent work may have partially fixed this since this file was authored). Start by deciding whether to relocate the middleware to `@erp/sdk` before wiring it into all 13 services, since that decision shapes every subsequent step."
