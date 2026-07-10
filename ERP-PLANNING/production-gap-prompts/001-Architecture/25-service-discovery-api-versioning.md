# [PG-010] Service Discovery & API Versioning Strategy

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Medium
**Complexity:** M — no new infrastructure component; the work is a routing-table convention plus a small number of route-prefix changes across services that currently lack one, gated by the gateway PG-001 introduces
**Depends on:** PG-001 (API Gateway) — this package assumes the gateway's per-service routing table already exists; a versioning strategy with no gateway to enforce it is unenforceable, per-service, duplicated 14 times
**Blocks:** none
**Primary service(s)/package(s):** apps/api-gateway (routing table extension), apps/auth-service, apps/notification-service, apps/report-service, apps/scheduler-service, apps/search-service (the 5 services with no version prefix today — see verification below)

---

## Overview

- **Business objective:** this codebase has 14 independently-deployable backend services with no shared convention for introducing a breaking API change. Today, if `sales-service` needed to change its invoice-creation request shape incompatibly, there is no established mechanism to run the old and new shapes side by side while `web-frontend`/`pos-frontend` migrate — a breaking change would just break every caller simultaneously. At the same time, this is explicitly **not** a service-discovery problem in the Consul/Eureka/service-mesh sense: with 14 known, statically-configured services and one gateway (PG-001), there is no dynamic registration/health-based routing need — services don't come and go, ports don't change at runtime, and there is no case in this codebase's actual scale (a handful of pods per service, not an elastic fleet) where a service needs to discover another service's address at runtime rather than read it from config. Recommending Consul/Eureka here would be solving a problem this system doesn't have, at the cost of a new distributed dependency with its own failure modes.
- **Current implementation:** verified directly by grepping every service's `main.ts` for its route-prefix registration: `tenant-service`, `inventory-service`, `sales-service`, `gst-service`, `accounting-service`, `purchase-service`, `hr-service`, `production-service`, and `event-service` (9 of 14) already register their business routes under `{ prefix: '/api/v2' }`. `auth-service`, `notification-service`, `report-service`, `scheduler-service`, and `search-service` (5 of 14) register routes with **no version prefix at all** — their paths are bare (`/login`, `/notifications`, `/reports/...`, `/jobs`, `/search`, etc.). This split is already visible in `web-frontend/src/api/client.ts`'s existing per-service prefix quirks, documented in PG-001's routing table (`001-api-gateway.md`, Architecture section) — PG-001 explicitly preserves each service's existing prefix-or-not behavior underneath the gateway rather than normalizing it, which is the right call for that package (a gateway rollout should not simultaneously be a breaking API migration) but leaves the inconsistency itself unresolved.
- **Current architecture:** service addressing today is entirely static config — every service reads its own `PORT` from an env var (`.env.example`, ports 3010-3023) and every caller (currently `web-frontend`, `pos-frontend`, and service-to-service `INTERNAL_API_KEY` calls like `scheduler-service`'s job handlers calling `inventory-service`'s `/api/v2/inventory/reconcile`, per `system-jobs.ts:72`) hardcodes the target service's base URL from its own env config. PG-001 collapses this to one gateway address for external/frontend callers but explicitly leaves direct service-to-service calls (scheduler→inventory, etc.) going directly service-to-service, unchanged, per that package's own Backward Compatibility section.
- **Current limitations:** no service in this codebase has ever shipped a `/api/v3` (or any second version) of anything — there is no precedent to check for correctness, and no rule preventing the next breaking change from being made in place (mutating `/api/v2/invoices`'s response shape directly) rather than introduced alongside the old version. The 9-vs-5 prefix split has no documented reason in any comment or commit message found during this pass — it reads as organic drift (some services were scaffolded from an older or newer template), not a deliberate versioning decision.

## Existing Code Analysis

- **What already exists and should be reused:** the gateway's routing table (PG-001, `001-api-gateway.md`, Architecture section) — this package extends that table's approach, it does not introduce a second routing mechanism. The already-established `/api/v2` prefix convention on 9 of 14 services — this package treats `v2` as the current baseline version everywhere (not `v1`; there is no `v1` anywhere in this codebase, confirmed by grep, so treating `v2` as "the current version" rather than renaming everything to `v1` avoids a pointless, purely-cosmetic breaking change across 9 services for no functional benefit).
- **What should never be modified:** the 9 services that already have `/api/v2` — do not rename their prefix (see above). Any of the 8 permission constants, request/response shapes, or business logic of the 5 unprefixed services — this package only wraps their existing routes in a version prefix, it does not touch their handlers.
- **Prior related work:** PG-001 (API Gateway) is the direct prerequisite — its Architecture section's routing table already lists per-service upstream paths including the `/api/v2`-or-not quirk this package resolves; re-read that table before starting, since it is the single source of truth this package must stay consistent with (do not let the two files' routing tables drift apart — if PG-001 has already shipped by the time this package starts, its `main.ts`/`config.ts` upstream map is the actual live table to extend, not this file's copy of it).

## Architecture

- **Decision: gateway-based routing table + URL-prefix versioning, not service discovery.** With 14 statically-known services and one gateway (post-PG-001), the gateway's own routing table (`Prefix → Upstream` map, e.g. `/api/sales` → `http://sales-service:3013`) already **is** the service registry this system needs — it is config, checked into source control, changed via a normal deploy, not a runtime-discovered, health-checked, gossip-protocol-backed registry. Introducing Consul/Eureka/a service mesh here would add a new stateful distributed system (its own HA/quorum concerns, its own failure mode when discovery itself is degraded) to solve a problem — dynamic service membership — that does not exist at this codebase's scale (fixed set of 14 named services, deployed as a known set, not auto-scaled workers registering themselves). This should be revisited only if the platform moves to a Kubernetes-native, auto-scaled-replica-count-per-service model where the gateway's static upstream map would need to become a Kubernetes `Service` DNS name lookup (already effectively "service discovery" via cluster DNS, which Kubernetes provides for free — still not Consul/Eureka) — that is PG-022's (Kubernetes production readiness) territory, not this package's.
- **Versioning convention going forward:** every service's *next* breaking change is introduced as a new prefix registered **alongside** the existing one in that service's `main.ts` (e.g., add `await fastify.register(v3Routes, { prefix: '/api/v3' })` next to the existing `{ prefix: '/api/v2' }` registration), never by mutating a route already reachable under `/api/v2` in an incompatible way. The gateway's routing table (PG-001) then exposes both prefixes to callers (`/api/{service}/api/v2/...` and `/api/{service}/api/v3/...`), letting `web-frontend`/`pos-frontend` migrate call-by-call rather than atomically. A version is retired (its registration removed) only after both frontends' `client.ts`/equivalent no longer reference it — a manual, deliberate step, not automatic sunset.
- **Prefix normalization for the 5 unprefixed services:** wrap `auth-service`, `notification-service`, `report-service`, `scheduler-service`, and `search-service`'s existing route registrations in `{ prefix: '/api/v2' }` (matching the other 9, establishing one consistent baseline), while **also** keeping each route reachable at its current unprefixed path for one deprecation window (register the same route plugin twice — once at root, once at `/api/v2` — rather than moving it outright) so `web-frontend`'s existing calls to these 5 services (which today go directly to the service root, per PG-001's routing table) don't break the same day this lands. `web-frontend`'s `client.ts` is updated to call the new `/api/v2`-prefixed path for these 5 services in the same change, and the unprefixed duplicate registration is removed in a follow-up once confirmed unused (mirrors the same "old path stays reachable during migration" discipline PG-001 already uses for direct-service-port access).
- **Component interactions:** no runtime behavior change for callers going through the gateway once both are in place — the gateway's routing table is the only thing that needs to know about a new version prefix; individual services don't need to know about each other's versioning at all (versioning is a per-service, per-route-tree concern, not a cross-service coordination problem), which is exactly why a heavier service-discovery mechanism isn't needed to solve it.

## Database Changes

Not applicable — no schema change. This is a routing/config convention, not a data-model change.

## Backend

- **Files to modify:** `apps/auth-service/src/main.ts`, `apps/notification-service/src/main.ts`, `apps/report-service/src/main.ts`, `apps/scheduler-service/src/main.ts`, `apps/search-service/src/main.ts` (each: wrap existing route registration in `{ prefix: '/api/v2' }` alongside the existing unprefixed registration, dual-registered during the deprecation window as described above). `apps/api-gateway/src/config.ts`/`main.ts` (PG-001's routing table, once PG-001 has shipped — or PG-001's own Architecture section's routing table, if authored before PG-001 lands, to keep the two files consistent) — update the upstream paths for these 5 services to route to their new `/api/v2` prefix as the primary path, keeping the unprefixed path reachable only for the deprecation window.
- **Events/Kafka, validation, authorization:** not applicable — this package touches route registration/prefixing only, not route handler logic, permission checks, or event payloads.
- **Documentation, not code, for the versioning convention itself:** add a short `VERSIONING.md` (or a section in `ERP_MASTER_SPEC.md`, whichever this repo's existing documentation convention prefers — check at implementation time) stating the "new prefix alongside old, retire only after both frontends migrate" rule from Architecture above, so the next breaking change anywhere in the codebase has a documented pattern to follow instead of being decided ad hoc per-service again.

## Frontend

- `apps/web-frontend/src/api/client.ts`: update the 5 affected services' path-building to use `/api/v2` (matching the other 9's existing quirk-preserving logic already described in PG-001's Frontend section) instead of no prefix.
- `apps/pos-frontend`'s equivalent base-URL file (path to confirm at implementation time, per PG-001's own note that this wasn't inventoried in that pass either): same change, for whichever of these 5 services `pos-frontend` actually calls (likely only a subset — POS is a narrower frontend than the full ERP SPA).

## API Contract

- No endpoint behavior changes — every existing route's method/request/response shape is unchanged. Only the URL prefix for 5 services' routes gains `/api/v2` (with the old, unprefixed path staying reachable during the deprecation window, then removed in a follow-up change once confirmed unused).

## Multi-Tenant Considerations

- Not applicable — this is a routing-layer convention with no tenant-data implication; every route's existing `requirePermission`/tenant-scoping logic is completely untouched.

## Integration

- **api-gateway (PG-001)**: its routing table is the single place a new version prefix or a new service needs to be registered — this package's entire value depends on that table existing and being kept in sync, which is why this package `Depends on: PG-001`.
- **auth-service, notification-service, report-service, scheduler-service, search-service**: each gets the dual-registration prefix change described above.
- **web-frontend, pos-frontend**: base-URL config updated for these 5 services only (the other 9 are already correctly `/api/v2`-prefixed in `client.ts` today, per PG-001's existing analysis).

## Coding Standards

- Reuses Fastify's existing `fastify.register(plugin, { prefix })` mechanism identically to how the other 9 services already do it — no new routing library, no new middleware. The "new prefix alongside old" versioning rule is a documentation/process convention, not a new code pattern — it reuses the exact same `fastify.register` call shape twice (root + `/api/v2`, or later `/api/v2` + `/api/v3`) rather than introducing a version-negotiation header or content-type versioning scheme, keeping this consistent with the rest of the codebase's preference for simple, explicit URL structure over content negotiation.

## Performance

- Negligible — an additional `fastify.register` call for the same route tree under a second prefix has no meaningful runtime cost; Fastify's radix-tree router handles multiple prefixes for the same handlers efficiently.

## Security

- Not applicable — no new permission surface; every dual-registered route keeps its existing `requirePermission()`/`authenticate` preHandlers unchanged, whichever prefix it's reached through.

## Testing

- Update each of the 5 affected services' existing route tests (locate via each service's `__tests__/` directory at implementation time) to assert routes are reachable under both the legacy unprefixed path and the new `/api/v2` path during the deprecation window.
- New `apps/api-gateway/src/__tests__/gateway-routing.test.ts` (already planned in PG-001's Deliverables) should include cases for these 5 services' updated upstream paths — coordinate with whichever session implements PG-001 if it lands after this package, or extend that test file if PG-001 has already shipped.
- Manual repro: for one of the 5 services (e.g. `search-service`), confirm `curl http://localhost:<port>/search` (legacy) and `curl http://localhost:<port>/api/v2/search` (new) both succeed identically during the deprecation window.

## Acceptance Criteria

- [ ] All 14 backend services register their primary route tree under `/api/v2` (the 9 that already did, unchanged; the 5 that didn't, now do).
- [ ] Each of the 5 newly-prefixed services still answers its legacy unprefixed path during the deprecation window (verified by a passing test asserting both paths work).
- [ ] `web-frontend`'s (and `pos-frontend`'s, where applicable) base-URL config calls the new `/api/v2` path for these 5 services.
- [ ] A short versioning-convention doc exists and is referenced from `ERP_MASTER_SPEC.md` or an equivalent top-level doc, stating the "new prefix alongside old, remove only after both frontends migrate" rule.
- [ ] No service anywhere in the codebase introduces a Consul/Eureka/service-mesh dependency as part of this package.

## Deliverables

- **Files to create:** a short versioning-convention doc (exact location to confirm against this repo's existing documentation layout at implementation time — likely `ERP-PLANNING/` alongside other cross-cutting specs, or a new `docs/API_VERSIONING.md`).
- **Files to modify:** `apps/auth-service/src/main.ts`, `apps/notification-service/src/main.ts`, `apps/report-service/src/main.ts`, `apps/scheduler-service/src/main.ts`, `apps/search-service/src/main.ts`, `apps/api-gateway`'s routing table (`config.ts`/`main.ts`, per PG-001), `apps/web-frontend/src/api/client.ts`, `apps/pos-frontend`'s equivalent file.
- **Migrations:** none.
- **APIs added/changed:** 5 services gain a `/api/v2`-prefixed path alongside their existing unprefixed one (dual-reachable during deprecation window, then unprefixed removed in a follow-up change).
- **Events added/changed:** none.
- **Tests added:** dual-path reachability tests for the 5 affected services; gateway routing-table test updates.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** 9 of 14 backend services (`tenant`, `inventory`, `sales`, `gst`, `accounting`, `purchase`, `hr`, `production`, `event`) already register routes under `/api/v2`; 5 (`auth`, `notification`, `report`, `scheduler`, `search`) register routes with no version prefix at all — confirmed by grepping every service's `main.ts` for its `{ prefix: ... }` registration. There is no `/api/v1` anywhere and no precedent for shipping a second version of any endpoint. PG-001 (API Gateway) documents this same 9-vs-5 split in its own routing table and deliberately preserves it rather than normalizing it (correctly, for that package's scope).

**Current Objective:** (1) establish and document a lightweight versioning convention — new breaking changes ship as a new prefix alongside the old one, retired only after both frontends migrate — and (2) normalize the 5 unprefixed services onto `/api/v2` (dual-registered with their legacy unprefixed path during a deprecation window) so the whole platform has one consistent baseline before any service needs a real `/api/v3`. Explicitly reject Consul/Eureka/service-mesh-style dynamic service discovery as unneeded at this codebase's scale (14 statically-known services, one gateway) — the gateway's own static routing table already serves as the "service registry" this system needs.

**Architecture Snapshot:** the gateway (PG-001) is the single place a version prefix needs to be registered for external/frontend callers; direct service-to-service calls (e.g. `scheduler-service` calling `inventory-service`'s `/api/v2/inventory/reconcile` directly, per `system-jobs.ts:72`) bypass the gateway entirely and are unaffected by this package unless the target service is one of the 5 being reprefixed (in which case the caller's hardcoded path needs the same `/api/v2` update).

**Completed Components:** the 9-service `/api/v2` convention already exists and is left untouched. PG-001's gateway routing table is the direct prerequisite this package extends.

**Pending Components:** actual introduction of a `/api/v3` anywhere is explicitly NOT part of this package — this package only establishes the convention and normalizes the baseline; the first real use of the "new prefix alongside old" pattern is future work, triggered whenever some service's first genuine breaking change happens. Kubernetes-native service discovery (cluster DNS replacing the gateway's static upstream map) is PG-022's territory, not this one's.

**Known Constraints:** no live service-mesh/Consul/Eureka infrastructure exists or should be introduced. Single shared Postgres/no RLS is irrelevant here (routing-layer package, no data-model touch).

**Coding Standards:** reuses Fastify's existing `fastify.register(plugin, { prefix })` mechanism, dual-registered during deprecation windows — no new routing library or version-negotiation scheme.

**Reusable Components:** PG-001's gateway routing table (extend, don't duplicate); the 9 already-`/api/v2`-prefixed services' registration pattern as the template for the 5 being normalized.

**APIs Already Available:** every existing endpoint of all 14 services — this package changes only their reachable path prefix for 5 of them, not their behavior.

**Events Already Available:** not applicable.

**Shared Utilities:** not applicable — this is a routing convention, not a shared code change.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** not applicable — no data-model or tenant-scoping touch.

**Security Rules:** every route's existing `requirePermission()`/`authenticate` preHandler is unchanged regardless of which prefix it's reached through.

**Database State:** not applicable.

**Testing Status:** each of the 5 affected services has its own existing route-level test coverage (location to confirm per-service at implementation time); none currently test dual-prefix reachability since there is nothing to test yet.

**Next Session Plan:** single session, but sequence after PG-001 has at least its routing-table/session-A work done (per PG-001's own "Next Session Plan" split) — starting this package before PG-001's routing table exists means duplicating that decision here and risking drift between the two files.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/25-service-discovery-api-versioning.md` (PG-010). Confirm PG-001's gateway routing table already exists (at least in file form) before starting — this package extends it, it does not duplicate it. Re-verify via grep which of the 14 services still lack a `/api/v2` prefix (the 5 named in this file: auth, notification, report, scheduler, search) in case concurrent work has already changed this since authoring. Add dual-registration (`/api/v2` + legacy unprefixed) to each of the 5, update the gateway routing table and both frontends' base-URL config, write the short versioning-convention doc, then tests."
