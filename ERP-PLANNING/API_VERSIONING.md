# API Versioning Convention (PG-010)

## Baseline

`/api/v2` is the current baseline for every backend service — not `/api/v1`; there is no `/api/v1` route family across any service (the two `report-service` routes literally named `/api/v1/reports/ar-aging` and `/api/v1/reports/ap-aging` are a pre-existing exception, predating this convention, and are left as-is rather than renamed for a purely cosmetic reason).

As of PG-010, all 14 backend services register their primary route tree under `/api/v2`:

- Already on `/api/v2` before PG-010: `tenant-service`, `inventory-service`, `sales-service`, `gst-service`, `accounting-service`, `purchase-service`, `hr-service`, `production-service`, `event-service`.
- Normalized onto `/api/v2` by PG-010: `auth-service`, `notification-service`, `report-service`, `scheduler-service`, `search-service`.

## Rule for the next breaking change

When any service needs to ship a breaking change to an existing endpoint:

1. Add the new route tree under a new prefix registered **alongside** the existing one in that service's `main.ts` — e.g. `await fastify.register(v3Routes, { prefix: '/api/v3' })` next to the existing `{ prefix: '/api/v2' }` registration.
2. Never mutate a route already reachable under `/api/v2` in an incompatible way (changed response shape, removed/renamed field, changed status code semantics).
3. Update `apps/api-gateway/src/config.ts`'s routing table so the gateway exposes the new prefix for that service.
4. Migrate `apps/web-frontend` and `apps/pos-frontend` call sites to the new prefix one call at a time.
5. Remove the old prefix's registration only after both frontends no longer reference it — a manual, deliberate step, not an automatic sunset.

This reuses Fastify's existing `fastify.register(plugin, { prefix })` mechanism — no version-negotiation header, no content-type versioning.

## PG-010's normalization of the 5 previously-unprefixed services

`auth-service`, `notification-service`, `report-service`, `scheduler-service`, and `search-service` previously registered routes with no version prefix at all. Each now dual-registers its route tree — once unprefixed (kept reachable for a deprecation window) and once under `/api/v2` (the new primary path) — in its `main.ts`. The unprefixed registration should be removed in a follow-up once confirmed unused by both frontends and any direct service-to-service caller.

Two exceptions inside `report-service`, found while implementing PG-010 (not covered by the "wrap in `{ prefix }`" mechanism above, since these routes hardcode their version directly into the literal path string rather than via a prefix wrapper):
- `analytics-reports.routes.ts` and `dashboard.routes.ts` already hardcode `/api/v2` (and, for the two aging reports, `/api/v1`) into each route's literal path. These are registered once, unmodified — wrapping them in an additional `/api/v2` prefix would have doubled it (`/api/v2/api/v2/reports`).
- `report.routes.ts` (`/reports/pdf`, `/internal/reports/outstanding-summary`) had no prefix at all and is the part PG-010 actually dual-registered.

## Gateway routing table

`apps/api-gateway/src/config.ts`'s `UPSTREAM_DEFAULTS` has one `apiV2: boolean` flag per service, controlling whether the gateway rewrites `/api/<service>/...` to `/api/v2/...` on the way to the upstream (`apps/api-gateway/src/app.ts`'s `rewritePrefix`). All 14 services now have `apiV2: true`, except `production` and `event` — those two already embed `/api/v2` directly in each call's literal path (mirroring `report`), so the gateway passes the path through unchanged (`rewritePrefix: ''`).

## Explicitly out of scope

No Consul/Eureka/service-mesh dependency was introduced by this convention. With 14 statically-known services behind one gateway, the gateway's own routing table (`config.ts`) already is the "service registry" this system needs — it's config, checked into source control, changed via a normal deploy. This should only be revisited if the platform moves to a Kubernetes-native, auto-scaled-replica-count model where cluster DNS would replace the static upstream map — that is Kubernetes production-readiness territory (see the PG-022 series), not this convention's.
