# [PG-001] API Gateway Implementation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Critical
**Complexity:** XL — touches every one of the 14 backend services' CORS/rate-limit/auth surface, both frontends' base-URL config, and CI; must be rolled out without breaking either frontend mid-migration
**Depends on:** none
**Blocks:** PG-010 (service discovery / API versioning strategy assumes a gateway routing table already exists)
**Primary service(s)/package(s):** apps/api-gateway, apps/web-frontend (apps/web-frontend/src/api/client.ts), apps/pos-frontend, .github/workflows/ci.yml

---

## Overview

- **Business objective:** today there is no single front door to the platform. Every one of 14 backend services (ports 3010–3023) is reachable directly from the public internet if its port is exposed, JWT validation/CORS/rate-limiting is duplicated 14 times with no guarantee of consistency, and there is no place to add cross-cutting controls (WAF rules, global rate limiting, blue/green routing, request logging correlation) without touching every service. This blocks a clean production network topology (one ingress, one TLS cert, one attack surface) and blocks PG-010's versioning strategy, which needs a routing layer to own `/v1/` prefixes.
- **Current implementation:** `apps/api-gateway/src/main.ts` is a 5-line stub:
  ```ts
  // API Gateway — implementation in later phases
  // Reverse-proxies requests to downstream microservices
  // JWT validation and tenant injection happen here
  export {};
  ```
  Its `package.json` already declares the right dependencies (`@fastify/http-proxy@^11.5.0`, `@fastify/cors@^11.2.0`, `@fastify/helmet@^13.0.2`, `@fastify/rate-limit@^11.1.0`, `fastify@^5.9.0`, plus `@erp/config`, `@erp/logger`, `@erp/sdk`, `@erp/types`) — none are imported anywhere in `src/`. No `PORT` is assigned in `.env.example` (every other service has one: auth 3010 … event-service 3023, scheduler 3016, search 3017).
- **Current architecture:** `apps/web-frontend/src/api/client.ts` hardcodes a `BASE_URLS` map of 12 direct service origins (`http://localhost:3010` … `3023`) with an inconsistent `/api/v2` suffixing rule (auth has no prefix; tenant/inventory/sales/gst/accounting/purchase/hr append `/api/v2` here; production/search/report/event/notification already embed their own prefix in `endpoints.ts` calls). `apps/pos-frontend` has its own equivalent base-URL map (not yet inventoried in this pass — verify at implementation time). Each service independently registers `@fastify/cors`, `@fastify/helmet`, and `@fastify/rate-limit` in its own `main.ts` (confirmed in `apps/tenant-service/src/main.ts`) and independently validates the RS256 JWT via its own `middleware/authenticate.ts` + `requirePermission()` in `middleware/authorize.ts`.
- **Current limitations:** `.github/workflows/ci.yml` line 181 explicitly excludes api-gateway from the Docker build matrix (`# api-gateway intentionally excluded — descoped in ES-27 (still a stub, see TECH_AUDIT.md)`), and the 14-service matrix (`auth-service, sales-service, inventory-service, accounting-service, purchase-service, hr-service, gst-service, notification-service, scheduler-service, search-service, report-service, tenant-service, event-service, production-service`) confirms this is a deliberate, tracked gap, not an oversight.

## Existing Code Analysis

- **What already exists and should be reused:** the per-service RS256 JWT verification (`verifyAccessToken` in `packages/platform-sdk/src/auth.ts`, exported from `@erp/sdk`), the `requirePermission()` preHandler pattern used identically in every service's `middleware/authorize.ts`, the internal-service-to-service auth convention already used for service-to-service calls (`x-internal-key` header + `timingSafeEqual` comparison — see `apps/sales-service/src/api/internal.routes.ts`), and the existing `@fastify/*` plugin versions already pinned in `apps/api-gateway/package.json` (do not bump versions to match — keep them identical to what every other service uses, currently `@fastify/cors@^11.2.0` / `@fastify/helmet@^13.0.2` / `@fastify/rate-limit@^11.1.0`).
- **What should never be modified:** the 14 services' own `authenticate`/`authorize` middleware must NOT be removed — this gap is additive (gateway in front), not a replacement of per-service authorization (defense in depth, see Architecture section). Do not touch `apps/web-frontend/src/api/client.ts`'s error-shape normalization logic (the `{error: string}` vs `{error:{code,message,details}}` handling) — the gateway must pass response bodies through unchanged.
- **Prior related work:** `ERP-PLANNING/audit-phase-prompts/ES-07-RBAC-PERMISSION-HARDENING.md` hardened per-service `requirePermission()` — that work is the reason per-service auth can safely stay in place as defense-in-depth. No prior phase-completion report touches api-gateway; `TECH_AUDIT.md` (referenced by the CI comment) documents it as an ES-27 descope decision, not a bug.

## Architecture

- **Topology:** api-gateway becomes the single ingress. It terminates client connections, does coarse-grained JWT signature verification + tenant-context extraction, and reverse-proxies to the correct backend service using `@fastify/http-proxy`, one proxy registration per service prefix. It does NOT re-implement `requirePermission()` fine-grained checks (298 permission constants) — that stays in each service, because the gateway has no visibility into route-specific permission requirements without duplicating every service's route table.
- **Routing table** (one `fastify.register(httpProxy, {...})` per service, prefix-based, mirroring `BASE_URLS` in `client.ts`):
  | Prefix | Upstream | Notes |
  |---|---|---|
  | `/api/auth` | `http://auth-service:3010` | no `/api/v2` on upstream, per existing convention |
  | `/api/tenant` | `http://tenant-service:3011/api/v2` | |
  | `/api/inventory` | `http://inventory-service:3012/api/v2` | |
  | `/api/sales` | `http://sales-service:3013/api/v2` | |
  | `/api/notification` | `http://notification-service:3014` | |
  | `/api/report` | `http://report-service:3015` | |
  | `/api/scheduler` | `http://scheduler-service:3016` | not currently in `client.ts` — admin-only, add for completeness |
  | `/api/search` | `http://search-service:3017` | |
  | `/api/gst` | `http://gst-service:3018/api/v2` | |
  | `/api/accounting` | `http://accounting-service:3019/api/v2` | |
  | `/api/purchase` | `http://purchase-service:3020/api/v2` | |
  | `/api/hr` | `http://hr-service:3021/api/v2` | |
  | `/api/production` | `http://production-service:3022` | |
  | `/api/event` | `http://event-service:3023` | |
- **Component interactions:** client → gateway (`PORT=3000`, new — no existing service claims this port) → `preHandler` hook does: (1) skip auth for `/health` and `/api/auth/auth/login` and `/api/auth/auth/refresh`; (2) verify JWT via `verifyAccessToken()` from `@erp/sdk` for every other route; (3) on success, forward the original `Authorization` header unchanged (services keep validating it themselves) and additionally inject `x-tenant-id`/`x-correlation-id` headers derived from the verified token so downstream services can trust the gateway's extraction without re-parsing (still validated independently downstream — defense in depth); (4) on JWT failure, return `401` from the gateway itself without proxying, so backend services never see malformed auth traffic.
- **Rate limiting:** register `@fastify/rate-limit` once at the gateway keyed by `tenantId` (post-JWT-verify) or IP (pre-auth routes), mirroring the tenant-or-IP-keyed convention already used per-service (per `ERP_MASTER_SPEC` cross-cutting guidance). This is now the primary rate-limit enforcement point; per-service rate-limit registrations stay as a secondary safety net (cheap to keep, do not remove — a service could still be reached directly during the migration window, see Deliverables).
- **CORS/Helmet:** register once at the gateway with the production origin allow-list; per-service CORS stays registered too (harmless when called service-to-service, and required for the direct-call fallback path described below).

## Database Changes

Not applicable — no schema change. The gateway is stateless; it holds no database connection.

## Backend

- **New files under `apps/api-gateway/src/`:**
  - `main.ts` — Fastify bootstrap: register helmet, cors, rate-limit, then the 14 `@fastify/http-proxy` registrations from the table above, then a `/health` route that fans out a shallow health check to each upstream's own `/health` (aggregate status, do not block on slow upstreams — use `Promise.allSettled` with a 2s timeout per upstream).
  - `middleware/gateway-auth.ts` — the `preHandler` described above, built on `verifyAccessToken` from `@erp/sdk` (do not reimplement RS256 verification — the function already exists and is what every service already calls).
  - `config.ts` — reads `PORT` (new env var, default `3000`), and one `<SERVICE>_UPSTREAM_URL` env var per service (defaults matching the table above), via `loadConfig()` from `@erp/config` extended with a gateway-specific upstream-map loader (small addition to `packages/config/src/index.ts`, additive only — do not change `AppConfig`'s existing fields).
- **Events/Kafka:** not applicable — the gateway does not participate in the outbox/Kafka layer.
- **Validation, authorization:** JWT signature + expiry check only at the gateway (coarse-grained); Zod is not needed here since the gateway does not parse request bodies, only headers and path prefixes. Full `requirePermission()` authorization remains exclusively in each service, unchanged.
- **Telemetry:** wire `initializeTelemetry` from `@erp/sdk` with `serviceName: 'api-gateway'` (the one thing every other service already does — `FEATURE_INVENTORY.md` §0 notes api-gateway is the only one of 14 services missing OTel/Prometheus/Winston wiring; this package closes that specific instance of the gap incidentally). Add a `prom-client` counter `erp_gateway_requests_total{service,status}` and a histogram `erp_gateway_proxy_duration_ms{service}`.
- **Idempotency/caching:** not applicable — the gateway proxies transparently; it must not cache or retry non-idempotent (POST/PUT/PATCH/DELETE) requests.

## Frontend

- `apps/web-frontend/src/api/client.ts`: change `BASE_URLS` to a single `GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000'`, and change each service's path building from `${BASE_URLS[service]}${path}` to `${GATEWAY_URL}/api/${service}${servicePrefixFor(service)}${path}`, reusing the exact same per-service `/api/v2`-or-not logic that already exists in the current map (do not change the per-service prefix quirks — replicate them under the gateway prefix). Keep the existing `refreshAccessToken()` special-case (plain fetch, no envelope) — just repoint its URL to `${GATEWAY_URL}/api/auth/auth/refresh`.
- `apps/pos-frontend`: same change to its equivalent base-URL config (verify its exact file path at implementation time — not confirmed in this pass; grep for a `BASE_URLS`-shaped constant analogous to web-frontend's).
- No new pages/components — this is a pure networking-layer change invisible to the UI.

## API Contract

- The gateway introduces no new business endpoints. It exposes:
  - `GET /health` → `200 { data: { gateway: 'ok', upstreams: { 'auth-service': 'ok'|'down', ... } } }`
  - Every existing endpoint of every service, unchanged in method/body/response shape, reachable at `{GATEWAY_URL}/api/{service}{existing-path}` instead of `{service-origin}{existing-path}`.
- Error codes: `401 UNAUTHENTICATED` (gateway-level JWT failure, before proxying), `502 UPSTREAM_UNAVAILABLE` (proxy target unreachable — `@fastify/http-proxy` default behavior, wrap with the same `{error:{code,message}}` envelope every other service uses so `apiClient`'s error parsing keeps working unchanged), `429 RATE_LIMITED` (gateway-level rate limit).

## Multi-Tenant Considerations

- The gateway must NOT attempt tenant-scoped data filtering — it has no database access. Its only tenant-related job is extracting `tenantId` from the verified JWT and forwarding it as an `x-tenant-id` header for downstream logging/rate-limit-keying; every service's own `requirePermission()` + `WHERE tenant_id = ?` remains the actual isolation boundary, unchanged.
- Feature-flag gating: not applicable — the gateway has no per-tenant feature awareness.

## Integration

- **All 14 backend services**: each becomes a proxy target; no code change required in any of them for this package alone (their own auth/CORS/rate-limit stay as-is — see Coding Standards).
- **web-frontend, pos-frontend**: base-URL config changes as described above; no other code changes.
- **CI (`.github/workflows/ci.yml`)**: add `api-gateway` back into the Docker build matrix (line ~190) and the security-scan matrix; remove the "intentionally excluded" comment.

## Coding Standards

- Reuses Fastify + the exact same `@fastify/cors`/`@fastify/helmet`/`@fastify/rate-limit` versions every other service already uses — no new HTTP framework, no new proxy library beyond the already-declared `@fastify/http-proxy`.
- Reuses `verifyAccessToken()` and `initializeTelemetry()` from `@erp/sdk` rather than re-implementing JWT verification or telemetry bootstrap.
- Novel-but-justified: this is the first service with no direct Postgres connection and no `requirePermission()` usage — that is intentional per the Architecture section (a gateway that duplicated 298 permission constants would be a second source of truth and violate the "no package should introduce a second way to do any of these" cross-cutting rule).

## Performance

- `@fastify/http-proxy` adds one network hop; budget +5–15ms p50 per request. Keep proxy `keepAliveConnections` on for upstream connections (avoid TCP+TLS renegotiation per request). Do not add response caching at the gateway — several proxied endpoints are per-user/per-tenant and caching at this layer would be a data-leak risk.
- Health-check fan-out must use a short timeout (2s) and `Promise.allSettled` so one slow/down service doesn't make `/health` hang for the load balancer.

## Security

- Centralizes JWT signature verification for one initial rejection point, reducing the blast radius of a malformed-token DoS reaching 14 separate services.
- Rate limiting is now enforced before traffic reaches any backend service, closing the gap where a flood could hit a single service's already-registered but independently-tunable rate limiter.
- OWASP: this closes part of API3:2023 (Broken Object Property Level Authorization is unaffected — still per-service) but directly addresses API4:2023 (Unrestricted Resource Consumption) by giving one place to tune global limits, and improves API8:2023 (Security Misconfiguration) by making CORS/Helmet policy centrally auditable instead of duplicated 14 times with drift risk.
- The gateway must never be the ONLY authentication check — see Backward Compatibility below for why direct-service-call paths must keep working during rollout, and therefore why per-service auth cannot be removed.

## Testing

- New `apps/api-gateway/src/__tests__/gateway-routing.test.ts`: verify each of the 14 prefixes proxies to the correct upstream (mock upstream servers with `nock` or a lightweight local Fastify instance per test), verify `/health` aggregates upstream statuses, verify a request with no `Authorization` header to a non-exempt path gets `401` without ever reaching the upstream mock.
- New `apps/api-gateway/src/__tests__/gateway-auth.test.ts`: expired/malformed/valid JWT cases, tenant-header injection correctness.
- Update `apps/web-frontend`'s existing Playwright E2E smoke suite's mocked-API base URL to go through the gateway path shape (`/api/{service}/...`) so the suite doesn't silently continue testing the old direct-call shape after the frontend migrates.
- Manual repro: `pnpm --filter @erp/api-gateway dev`, then hit `curl http://localhost:3000/api/sales/api/v2/invoices` with a valid token and confirm it reaches sales-service.

## Acceptance Criteria

- [ ] `apps/api-gateway/src/main.ts` is no longer `export {}` — it boots a Fastify server on `PORT` (default 3000) and proxies all 14 service prefixes.
- [ ] `pnpm --filter @erp/api-gateway type-check` and `pnpm --filter @erp/api-gateway test` pass.
- [ ] `apps/web-frontend/src/api/client.ts` calls resolve through the gateway in a local dev run (verified by `run` skill / manual browser check: login, load dashboard, confirm network tab shows `localhost:3000` origin for API calls).
- [ ] `.github/workflows/ci.yml` builds and security-scans an `api-gateway` Docker image; the "intentionally excluded" comment is removed.
- [ ] A request to any backend service's port directly (e.g. `curl localhost:3013/api/v2/invoices`) still succeeds during the migration window (see Backward Compatibility) — i.e. this package does not firewall off direct service ports; that is a separate, later infra decision (out of scope here, flag for PG-022/Kubernetes readiness).
- [ ] An expired/missing JWT against the gateway returns `401` without the request ever reaching a backend service (verify via upstream request log absence).

## Deliverables

- **Files to create:** `apps/api-gateway/src/main.ts` (replace stub), `apps/api-gateway/src/middleware/gateway-auth.ts`, `apps/api-gateway/src/config.ts`, `apps/api-gateway/src/__tests__/gateway-routing.test.ts`, `apps/api-gateway/src/__tests__/gateway-auth.test.ts`.
- **Files to modify:** `apps/web-frontend/src/api/client.ts`, `apps/pos-frontend`'s equivalent base-URL file (path to confirm at implementation time), `.github/workflows/ci.yml` (Docker build matrix + security-scan matrix), `.env.example` (add `PORT=3000` under a new "API Gateway" section + `VITE_GATEWAY_URL=http://localhost:3000`), `packages/config/src/index.ts` (additive: optional upstream-map loader, do not touch existing `AppConfig` fields), `docker-compose.yml` (add an `api-gateway` service block mirroring the other 14).
- **Migrations:** none.
- **APIs added/changed:** new `GET /health` on the gateway; every existing service endpoint gains a second reachable path via the gateway (old direct path stays reachable — see Backward Compatibility).
- **Events added/changed:** none.
- **Tests added:** `gateway-routing.test.ts`, `gateway-auth.test.ts`, updated Playwright smoke-suite base URL.

---

## Backward Compatibility & Rollout (gap-specific — folded into Architecture per template guidance to keep this a single cohesive read)

- **Frontend base URLs:** change once, in one file per frontend (`client.ts` for web-frontend). This is a config change, not a per-call-site change, so the blast radius is small and reviewable in one diff.
- **Can services still be called directly during migration?** Yes, deliberately. This package does not add network policies/firewalls blocking direct service ports — it only stands up the gateway as an additional path. Removing direct reachability is a Kubernetes/ingress-configuration decision (belongs to PG-022, out of scope here) that should happen only after the gateway has been running in production long enough to trust it, and only after `INTERNAL_API_KEY`-style service-to-service calls (scheduler→services, sales→notification, etc.) are confirmed to still work — those calls should keep going service-to-service directly (not through the gateway) since they are trusted internal traffic, not client traffic.
- **CI re-inclusion:** add `api-gateway` to both the `Build` matrix and `Security Scan` matrix in `.github/workflows/ci.yml`; its `Dockerfile` does not yet exist and must be created following the same multi-stage pattern as the other 14 (verify against `apps/scheduler-service/Dockerfile` as a template, per the ES-27 Dockerfile-build fixes documented in project history).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/api-gateway` has never been implemented past its scaffold — `package.json` has the right dependencies, `main.ts` is a 5-line placeholder. Every frontend calls all 14 backend services directly by port. CI deliberately excludes api-gateway from its Docker build matrix (ES-27 descope, tracked in `TECH_AUDIT.md`).

**Current Objective:** stand up a real Fastify-based reverse-proxy gateway in front of all 14 services: JWT verification, tenant-header injection, centralized CORS/rate-limit, health aggregation — without removing any per-service auth (defense in depth) and without breaking direct service-to-service or direct-port access during the migration window.

**Architecture Snapshot:** 14 backend services on ports 3010–3023 (see routing table above); each already has its own `@fastify/cors`/`helmet`/`rate-limit` and `requirePermission()` middleware; `@erp/sdk`'s `verifyAccessToken()` is the shared JWT-verification function every service already calls; `web-frontend/src/api/client.ts` is the single file that knows every service's base URL today.

**Completed Components:** per-service RBAC hardening (ES-07), per-service Dockerfiles (ES-27).

**Pending Components:** Kubernetes ingress / network-policy lockdown of direct service ports (PG-022, deliberately out of scope here); API versioning strategy / `/v1/` prefix scheme (PG-010, depends on this package existing first).

**Known Constraints:** single shared Postgres, no RLS — irrelevant to the gateway since it holds no DB connection. The gateway must remain stateless (no Redis/Postgres dependency) to keep it simple to scale horizontally.

**Coding Standards:** see Coding Standards section above — Fastify + existing `@fastify/*` plugin versions + `@erp/sdk`'s `verifyAccessToken`/`initializeTelemetry`, no new frameworks.

**Reusable Components:** `verifyAccessToken` (`packages/platform-sdk/src/auth.ts`), `initializeTelemetry` (`packages/platform-sdk/src/telemetry.ts`), the `x-internal-key` service-to-service auth convention (`apps/sales-service/src/api/internal.routes.ts` as reference).

**APIs Already Available:** every existing service endpoint — this package adds no new business endpoints, only a new path to reach existing ones plus a `/health` aggregator.

**Events Already Available:** not applicable — the gateway does not touch Kafka/outbox.

**Shared Utilities:** `@erp/logger` (`createLogger`), `@erp/config` (`loadConfig`, to be extended additively), `@erp/types` (for the shared error envelope shape).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** gateway extracts and forwards `tenantId` for logging/rate-limit-keying only; it is never the enforcement boundary — that stays per-service.

**Security Rules:** gateway-level check is JWT signature/expiry only, not permission-level; every service's existing `requirePermission()` constant checks are unchanged and must keep running.

**Database State:** not applicable.

**Testing Status:** zero tests exist today (the file is a stub). New test files listed in Deliverables.

**Next Session Plan:** given XL complexity, split as: (1) session A — `main.ts` + routing table + health aggregation + Dockerfile + CI matrix re-inclusion; (2) session B — `gateway-auth.ts` JWT/tenant-header middleware + rate-limit/CORS/helmet config + its tests; (3) session C — frontend `client.ts`/pos-frontend base-URL migration + Playwright smoke-suite update + manual verification pass. Each session should re-verify the routing table's port numbers against current `.env.example` before starting, since new services could have been added since this file was written.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/22-api-gateway.md` (PG-001). Before writing code, re-verify the 14-service port table in the Architecture section against the current `.env.example` and `.github/workflows/ci.yml` Docker matrix — services may have been added or reassigned ports since this file was authored. Start with session A (main.ts + routing + health + Dockerfile + CI) per the Next Session Plan; do not touch web-frontend/pos-frontend until session C."
