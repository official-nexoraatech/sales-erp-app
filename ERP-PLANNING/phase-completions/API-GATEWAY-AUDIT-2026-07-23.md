# API Gateway — Comprehensive Enterprise Audit (2026-07-23)

**Status:** Read-only investigation complete. F2, F1, and F3 all implemented and verified this session (see §8, §9, §10). No open findings from the original prioritized set remain; §3/§4 (medium-priority items F4–F8, and the explicitly-out-of-scope items) still stand as documented, not implemented.

## 1. Current Architecture (as verified from code, not docs)

`apps/api-gateway` is a single ~200-line Fastify 5 app (`src/app.ts` + `src/config.ts` + `src/middleware/gateway-auth.ts` + `src/main.ts`). It is real, running code — not a stub (an earlier `ERP_MASTER_SPEC.md` line claiming otherwise is stale, per existing memory).

Registration order in `buildGateway()` (`app.ts`):

1. `registerErrorHandler` (must be first — Fastify's `setErrorHandler` only propagates to child contexts that exist when it's set)
2. `onRequest` correlation-ID hook
3. `@fastify/helmet` (strict CSP, HSTS, CORP fixed to `cross-origin` after a documented 2026-07-19 incident)
4. `onSend` hook adding `Permissions-Policy`
5. `@fastify/cors` (methods include PUT/PATCH/DELETE — fixed after a 2026-07-12 platform-wide CORS bug; origin from `ALLOWED_ORIGINS` env)
6. `@fastify/rate-limit` (global, 200 req/min, `tenantOrIpKeyGenerator`)
7. `onResponse` Prometheus metrics hook
8. `/health` (aggregates all 14 upstreams' own `/health` via 2s-timeout fetch, `Promise.allSettled`-style via `HealthCheckFn` map)
9. `/metrics` (Prometheus scrape endpoint)
10. `preHandler` hook: `gatewayAuthPreHandler` (JWT signature/expiry/issuer check via `verifyAccessToken`)
11. 14× `@fastify/http-proxy` registrations, one per backend service, static target from env var, `rewritePrefix` either `/api/v2` or `''` depending on each service's own routing convention (`apiV2` flag in `config.ts`)

Routing table (`config.ts`): 14 services, static `<SERVICE>_SERVICE_URL` env vars, no dynamic discovery — this is a **documented, deliberate architecture decision** (PG-010, `ERP-PLANNING/API_VERSIONING.md`), not an oversight: at 14 statically-known services with no auto-scaling, the config file itself is the "service registry," and Consul/Eureka/service-mesh was explicitly evaluated and rejected as solving a problem this system doesn't have.

Auth model: coarse-grained only (signature + expiry + issuer). Fine-grained `requirePermission()` stays in each of the 14 services (defense in depth, gateway has no route-table visibility into per-route permissions) — also a documented decision, not a gap.

Both frontends (web-frontend, pos-frontend) route through the gateway as of the 2026-07-16 cutover — confirmed still current by reading `client.ts` directly (`GATEWAY_URL` + `/api/<service>` paths), not just trusting memory.

## 2. Request Lifecycle (actual, verified)

```
Client → HTTPS (terminated outside this app — no in-process TLS; standard for a
          container behind a cloud LB/ingress, not itself a gap) → Fastify
        → correlationId hook → Helmet → CORS → global rate-limit (IP or tenant key)
        → metrics hook → [route dispatch: /health | /metrics | proxy]
        → gatewayAuthPreHandler (skipped only for /health, listed EXEMPT_PATHS,
          EXEMPT_PREFIXES, and the one QUERY_TOKEN_PATHS SSE route)
        → @fastify/http-proxy → backend service → response passed through
          unchanged → onSend (Permissions-Policy) → client
```

No response caching (deliberate — proxied responses are per-tenant/per-user; caching here would be a data-leak risk, correctly not built). No compression. No circuit breaker. No load balancing (single static target per service).

## 3. Confirmed Findings

Findings are grounded in code I read and, where the finding was non-obvious, in a live `app.inject()` probe I ran against the built gateway — not assumptions.

### 🔴 Critical

**F1 — Rate limiting is never actually tenant-keyed; it is always IP-keyed, silently.**

- **Where:** `app.ts:63-67` registers `@fastify/rate-limit` as a global (`onRequest`-phase) plugin with `keyGenerator: tenantOrIpKeyGenerator`. That hook is registered at `app.ts:81`, and `gatewayAuthPreHandler` (`middleware/gateway-auth.ts`) never decorates `request.auth` — by design, per its own comment, it deliberately does not propagate `tenantId` onto the request. `tenantOrIpKeyGenerator` (`packages/platform-sdk/src/rate-limit.ts`) reads `request.auth?.tenantId`, which is therefore always `undefined` at the gateway, every single request.
- **Effect:** the rate limiter always falls back to `request.ip`. The `tenantOrIpKeyGenerator` import exists and looks correct at a glance but never does what its name implies at this specific call site.
- **Business impact:** no per-tenant fairness. Multiple tenants behind the same corporate NAT/proxy share one 200 req/min bucket (one noisy tenant can starve every other tenant on that IP). Conversely a single tenant spinning up many users/sessions from distinct IPs gets a multiplied effective budget with no per-tenant ceiling at all.
- **Technical root cause:** the SDK's own comment in `rate-limit.ts` already warns about this exact failure mode ("when registered as a global onRequest-level rate limiter, this runs before the authenticate preHandler populates request.auth, so global limiting is effectively IP-keyed") — the gateway hit precisely the documented pitfall.
- **Fix shape (not yet implemented):** move JWT verification earlier (before rate-limit) so a decoded tenantId is available to the key generator, or decorate `request.auth` from `gatewayAuthPreHandler` and re-order registration so rate-limit's `onRequest` phase runs after auth resolves (requires switching rate-limit to a `preHandler`-phase hook, since `onRequest` always precedes `preHandler` in Fastify's lifecycle) — needs a decision on whether unauthenticated (login, refresh, forgot-password) requests keep IP-keying as a fallback, which they should.
- **Regression risk:** low-medium — changes the effective rate-limit bucket boundary; anything currently relying on IP-keyed behavior for exempt/pre-auth routes must be preserved explicitly.

### 🟠 High

**F2 — `/metrics` is unauthenticated in every one of the other 14 services but requires a valid JWT at the gateway, and the gateway is not even in the Prometheus scrape config.**

- **Verified live:** I built the gateway and called `app.inject()` directly — `GET /metrics` with no Authorization header returns **401**, while `GET /health` correctly returns through (503 in the probe, since upstreams were unreachable dummies, but not 401).
- **Root cause:** every other service (`auth-service/src/main.ts:174` etc.) registers `authenticate` as a preHandler on a **child-scoped** `fastify.register(async (scope) => { scope.addHook(...) })` block, leaving `/metrics` (registered on the parent instance) outside that scope. The gateway instead registers `gatewayAuthPreHandler` directly on the **root** instance (`app.ts:81`), so it applies to every route on that instance — `/health` is saved only because it's explicitly listed in `EXEMPT_PATHS`; `/metrics` was never added to that list and has no scope boundary to exempt it structurally.
- **Compounding gap:** `infrastructure/docker/prometheus/prometheus.yml` has scrape jobs for all 14 backend services (`erp-auth-service` … `erp-production-service`) but **no `erp-api-gateway` job at all** — so today the gateway has zero Prometheus monitoring, and even adding the job naively would scrape a permanent 401 until F2's code issue is also fixed.
- **Business impact:** the single front door for the entire platform — the component whose health matters most for "Highly Available" — currently has zero visibility into its own request volume, latency, error rate, or rate-limit-rejection rate in Prometheus/Grafana.
- **Regression risk:** low — adding `/metrics` to `EXEMPT_PATHS` (or, better, restructuring like the other 14 services with a scoped auth block) mirrors an already-established, well-tested pattern.

**F3 — No circuit breaker on the proxy path, unlike every direct service-to-service call in this codebase.**

- **Verified:** `packages/platform-sdk/src/circuitBreaker.ts` exports `createCircuitBreaker` (opossum-based: 5 failures/10s → open, 30s half-open) and it's already used by `scheduler-service`, `sales-service` for their direct inter-service calls. The gateway's `@fastify/http-proxy` registrations (`app.ts:83-100`) have no equivalent — a dead/slow backend just times out per-request, repeatedly, with only a generic `onError` → 502 handler and no fast-fail or recovery-probing.
- **Business impact:** if one backend service degrades, every client request routed to it pays the full proxy timeout every time, and the gateway does nothing to shed that load or fail fast — directly undermines "Fault Tolerant"/"Resilience," and is inconsistent with how the rest of this platform already treats cross-service calls.
- **Technical complexity:** `@fastify/http-proxy` manages its own upstream HTTP client internally; it isn't a simple "wrap this async function in a breaker" situation like the existing `createCircuitBreaker` call sites — would need either a pre-proxy health/breaker-state check per upstream (cheap, reuses the same 2s upstream check already built for `/health`) or evaluating whether `@fastify/http-proxy`'s own `upstream`-level options (keep-alive, retry) cover enough of this without a full breaker library.
- **Regression risk:** medium — must not change behavior for currently-healthy upstreams; must not introduce false positives that open the breaker on transient blips shorter than what a normal user would tolerate.

### 🟡 Medium

**F4 — Single global rate-limit tier (200 req/min), no per-route/per-service differentiation.**
Matches what PG-001 originally scoped (a coarse first pass), but falls short of this audit's own "Per API" rate-limiting objective. A bulk-export/report-generation endpoint and a cheap read endpoint share one budget. Not a bug — a real, scoped gap. Fixing requires deciding which routes need a stricter/looser tier, which is a product decision, not something to infer silently.

**F5 — No response compression (`@fastify/compress`) anywhere in the monorepo, gateway included.**
Platform-wide gap, not gateway-specific, but the gateway is now the single natural place to add it once (rather than 14x). Low urgency — this system's JSON payloads are paginated ERP data, not large media; impact is bandwidth/latency on larger report/list responses, not correctness.

**F6 — No load balancing / multi-instance upstream support.**
`config.ts` has exactly one static target URL per service. Fine at current scale (single Postgres, no auto-scaled replicas) — explicitly deferred to Kubernetes-readiness (PG-022) in the existing docs, which is the same territory where cluster-DNS-based service discovery would also land. Flagging as a known, deliberately-deferred gap, not something to build speculatively now.

**F7 — Access-token revocation is TTL-only (15-minute exposure window).**
`JWT_ACCESS_TOKEN_TTL_SECONDS` defaults to 900s. Refresh-token revocation is real (rotation on refresh, revoke-all on logout/password-reset — verified in `auth-service`), but a stolen/compromised **access** token remains valid at the gateway for up to 15 minutes with no denylist check. This is a standard, industry-accepted stateless-JWT trade-off, not an oversight — flagging as a decision point (would need a Redis-backed denylist + a lookup on every gateway request, trading gateway statelessness for tighter revocation) rather than a bug to silently fix.

**F8 — No explicit `bodyLimit` override; unverified whether `@fastify/http-proxy` even applies Fastify's body-parsing limit to proxied (streamed) requests.**
Not confirmed as a bug — flagging as an open question worth a direct test (large-payload upload through the gateway to an upload-handling route) before deciding whether any change is needed here.

## 4. Explicitly Out of Scope (by design, not oversight — matches existing precedent in PG-010/API_VERSIONING.md)

These map to checklist items in the audit prompt that do not fit this system's actual scale, and building them now would be exactly the kind of speculative, unrequested complexity this project's own CLAUDE.md guidelines warn against:

- **Service discovery (Consul/Eureka/service mesh):** already explicitly evaluated and rejected in `ERP-PLANNING/API_VERSIONING.md` — 14 statically-known services, no auto-scaling, static config already serves as the registry.
- **Blue/green, canary, weighted routing:** no current multi-version-in-parallel deployment need; nothing in this codebase ships two live versions of a service simultaneously today.
- **WAF, bot protection, IP allow/deny lists, DDoS mitigation:** standard practice is a cloud edge (Cloudflare/ALB/ingress) in front of the app, not reimplementing packet-level defenses inside a Fastify process. Recommend as an infra/hosting decision, not app code.
- **API keys / M2M client registration / developer portal / usage analytics for external consumers:** zero third-party API consumers exist today (internal service-to-service calls already use a separate `x-internal-key` convention and bypass the gateway entirely, by design). Building a client-registration system now would be pure speculation.
- **mTLS / certificate rotation:** no evidence TLS is terminated inside any of these Node processes anywhere in the platform (consistent architecture — that's an ingress/LB concern).

## 5. Testing Assessment

Existing coverage (`gateway-routing.test.ts`, `gateway-auth.test.ts`) is genuinely solid for what it covers: all 14 proxy targets, health aggregation, missing/malformed/expired/wrong-key JWT, exempt paths, the SSE query-token fallback (itself a real regression test from a 2026-07-17 live-QA finding). Gaps: no test exercises rate-limiting behavior, `/metrics` reachability, or proxy behavior when an upstream is down (502 path) — F1/F2/F3 above are exactly the kind of thing this gap in test coverage let through unnoticed.

## 6. Recommended Priority Order

1. **F2** (`/metrics` 401 + missing Prometheus job) — ✅ shipped (§8).
2. **F1** (rate limit never tenant-keyed) — ✅ shipped (§9).
3. **F3** (circuit breaker on proxy path) — ✅ shipped (§10).
4. F4/F5/F6/F7/F8 — real but lower urgency; still recommend deferring until product/infra input is available (rate-limit tiers need business input; compression/load-balancing are platform-wide or Kubernetes-scoped; F7/F8 are decision points, not confirmed bugs).

## 7. Production Readiness Score

**Baseline ~72/100** for what this system actually needs at its current scale (not against an Apigee/Kong-Enterprise yardstick, which would be the wrong bar for a 14-service, single-Postgres, non-auto-scaled platform). Strong on auth defense-in-depth, CORS/Helmet hardening (both already patched from real prior incidents), versioning discipline, and test coverage of the routing/auth core.

**Post F2+F1+F3 (all shipped this session): ~84/100.** Gateway self-observability (F2), rate-limit correctness (F1), and resilience-under-upstream-failure (F3) were the three concrete, fixable gaps behind the original score — all three are now closed and live-verified. Remaining gap to a higher score is F4–F8 (§3 Medium, §4 out-of-scope-by-design) — none blocking for this system's current scale, several requiring product/infra decisions rather than code.

## 8. Implementation Log — F2 (shipped 2026-07-23)

**Issue:** `/metrics` required a valid JWT at the gateway (verified live via `app.inject()`: 401 with no Authorization header), unlike all 14 other services, and the gateway had no Prometheus scrape job at all (`prometheus.yml` had an explicit comment removing it as an ES-27 stub — stale, since PG-001/PG-010 made it real, running code).

**Root cause:** `gatewayAuthPreHandler` is registered on the gateway's root Fastify instance (necessary so it covers every proxy route), unlike the other 14 services which scope their auth hook to a child plugin and leave `/metrics` outside it. `/metrics` was never added to the gateway's `EXEMPT_PATHS` allowlist that the same mechanism already uses for `/health`.

**Business justification:** the gateway is the single front door for the entire platform; having zero request-volume/latency/error-rate visibility into it is a blind spot disproportionate to its importance.

**Technical justification:** reuses the exact `EXEMPT_PATHS` mechanism already established and tested for `/health` — no new code pattern, no restructuring of the auth hook's scope.

**Impact analysis:** `/metrics` becomes reachable without a bearer token, matching every other service in the platform. No change to any authenticated route's behavior.

**Regression analysis:** low risk — additive to an existing, well-tested allowlist. Verified via a new regression test (`gateway-auth.test.ts`: "allows /metrics through without an Authorization header") plus the full existing 31-test suite (30 prior + 1 new) passing, and a clean `tsc --noEmit`.

**Files modified:**

- `apps/api-gateway/src/middleware/gateway-auth.ts` — added `/metrics` to `EXEMPT_PATHS`.
- `apps/api-gateway/src/__tests__/gateway-auth.test.ts` — added a `/metrics` route to the test app + a regression test.
- `infrastructure/docker/prometheus/prometheus.yml` — added the `erp-api-gateway` scrape job (`host.docker.internal:3000`, `/metrics`, 15s interval), removing the stale ES-27 "still a stub" comment.

**Testing performed:** `pnpm --filter @erp/api-gateway test` → 31/31 passed. `pnpm --filter @erp/api-gateway type-check` → clean. Not live-verified against a running Prometheus container this session (no Docker stack was started) — recommend confirming the `erp-api-gateway` target shows **UP** in Prometheus's `/targets` page next time the observability stack and gateway are both running.

**Expected result:** Prometheus can scrape the gateway's request/latency/error metrics going forward. **Actual result:** confirmed via direct `app.inject()` probe and the new test that the endpoint no longer 401s; end-to-end scrape against a live Prometheus instance not yet observed.

## 9. Implementation Log — F1 (shipped 2026-07-23)

**Issue:** the gateway's global rate limiter imported `tenantOrIpKeyGenerator` but `request.auth` never existed at the point the key generator ran, so every request was silently IP-keyed regardless of tenant (see §3, F1 for the original root-cause analysis).

**Design constraint discovered mid-implementation (not visible from reading the code alone — found empirically):** the obvious-looking fix — register `gatewayAuthDecorate` (verify + attach `request.auth`, never rejects), then `@fastify/rate-limit` with `hook: 'preHandler'`, then `gatewayAuthReject` (401 if still unauthenticated), relying on registration order to interleave them — does **not** work. `@fastify/rate-limit`'s `global: true` mode always attaches its check as a **route-level** hook via an internal `onRoute` listener, and Fastify always executes all instance-level `fastify.addHook()` hooks of a given phase before any route-level hook of that same phase, regardless of the order `register()`/`addHook()` calls appear in source. A first implementation attempt using this approach passed 3 of 4 new tests but failed the one proving invalid-token floods still get IP-capped — the rate limiter's key generator was never even being invoked for unauthenticated requests, because `gatewayAuthReject` (also instance-level) ran and sent its 401 before the route-level rate-limit hook ever got a turn. Traced by reading `@fastify/rate-limit`'s source (`addRouteRateHook`/`onRoute` in `index.js`) and confirmed with a standalone reproduction script before touching the real fix.

**Actual fix:** register `@fastify/rate-limit` with `global: false` (so it does not self-attach via `onRoute`), then use the plugin's own `fastify.rateLimit()` decorator — which returns the identical check as a plain `(request, reply) => Promise` handler — inserted via `fastify.addHook('preHandler', fastify.rateLimit())` at the exact point needed in the gateway's own instance-level hook chain: `gatewayAuthDecorate` → `fastify.rateLimit()` → `gatewayAuthReject`. All three are now instance-level hooks, so Fastify's registration-order guarantee actually applies.

**Business justification:** restores real per-tenant rate-limit fairness — the property F1 found was silently never working — without weakening the existing IP-based flood protection for unauthenticated/invalid-token traffic.

**Technical justification:** `gatewayAuthDecorate` performs a full, real `verifyAccessToken()` (signature + expiry + issuer), not a cheap unverified decode — deliberately, because an unverified decode would let anyone fabricate a JWT-shaped token with an arbitrary `tenantId` claim (no cryptography needed to forge an unsigned claim) and use it to exhaust a victim tenant's quota with zero valid credentials. Requiring a real signature closes that off: only a caller already holding a currently-valid token for a given tenant can ever count against that tenant's bucket.

**Impact analysis:** authenticated requests are now rate-limited per-tenant (`tenant:<id>`) instead of per-IP. Unauthenticated/invalid-token requests are unaffected — still IP-keyed, still counted, still capped, exactly as before. No change to `RATE_LIMIT_DEFAULTS` (200 req/min) itself.

**Regression analysis:** the full existing 31-test suite plus a new `gateway-rate-limit.test.ts` (4 tests) covering: (1) two different tenants sharing an IP get independent buckets, (2) a single tenant's own limit is still enforced, (3) unauthenticated requests are still IP-rate-limited rather than exempted, (4) a token forged with the wrong signing key cannot pre-empt a victim tenant's real quota. All 35 tests pass. Also verified end-to-end against the real built `dist/` output (not just the standalone unit-test app) via a throwaway probe script — `/metrics` open, a valid token reaching the proxy layer (502 from a deliberately-dead upstream, proving auth passed), and a tokenless request still 401ing.

**Files modified:**

- `apps/api-gateway/src/app.ts` — rate-limit registration changed to `global: false` + `fastify.rateLimit()` inserted into the instance-level preHandler chain between decorate and reject.
- `apps/api-gateway/src/middleware/gateway-auth.ts` — split the single `gatewayAuthPreHandler` into `gatewayAuthDecorate` (verify + attach `request.auth`, never rejects) and `gatewayAuthReject` (the actual 401 decision), plus a `declare module 'fastify'` augmentation for `request.auth` (mirrors the pattern already used in every other service's `middleware/authenticate.ts`).
- `apps/api-gateway/src/__tests__/gateway-auth.test.ts` — updated to register both hooks in the new order; no behavioral assertions changed.
- `apps/api-gateway/src/__tests__/gateway-rate-limit.test.ts` — new file, 4 tests (see above).

**Testing performed:** `pnpm --filter @erp/api-gateway test` → 35/35 passed. `pnpm --filter @erp/api-gateway type-check` and `build` → clean. `pnpm --filter @erp/api-gateway lint` → 0 errors (3 pre-existing warnings, unrelated to this change). Live probe against the compiled `dist/` build via `buildGateway()` directly.

**Expected result:** per-tenant rate-limit fairness at the gateway. **Actual result:** confirmed by test and live probe; not yet observed under real production-like concurrent multi-tenant traffic (only deterministic single/two-tenant scenarios were exercised).

## 10. Implementation Log — F3 (shipped 2026-07-23)

**Issue:** no circuit breaker on the gateway's proxy path — a dead/slow backend meant every request to it timed out individually, repeatedly, with no fast-fail (see §3, F3 for the original analysis).

**Design decision (user-selected):** drive the breaker from real proxied-request outcomes (via `@fastify/http-proxy`'s existing `onError` callback, plus a passing `onResponse`), not a separate periodic health-poll. Rationale: reflects what actual traffic is experiencing, adds zero per-request cost while the circuit is closed (the common case), and doesn't require a new background interval process. The alternative (poll each upstream's own `/health` on a timer) was presented and explicitly not chosen.

**Why this couldn't reuse `createCircuitBreaker` (packages/platform-sdk/src/circuitBreaker.ts) as-is:** that opossum-based helper wraps a single async action's own call/response — every direct service-to-service call in this codebase (scheduler→inventory, sales→notification) fits that shape. `@fastify/http-proxy` has no equivalent seam: it manages its own HTTP forwarding internally and never hands back a promise representing "the proxied call" for something else to wrap. `apps/api-gateway/src/upstream-circuit-breaker.ts` is a small, self-contained external-signal state machine instead — closed/open/half-open, fed by explicit `recordSuccess()`/`recordFailure()` calls from the gateway's own hooks — using the exact same numbers as `createCircuitBreaker`'s defaults (5 failures/10s → open, 30s cool-down) for consistency with the rest of the platform, plus a half-open single-trial gate (only one probe request allowed through per cool-down, others rejected fast) and a 10s stuck-probe safety net (if a half-open trial never resolves — e.g. a black-holed connection with no fast refusal — the breaker re-opens with a fresh cool-down rather than staying wedged forever).

**Wiring:** each of the 14 upstreams is now registered inside its own child-scoped plugin (`fastify.register(async (scope) => {...})`) — the same encapsulation technique already used throughout this codebase to scope a hook to a subset of routes (e.g. every service's own `authenticate`/`requirePermission` child-plugin pattern, and the exact mechanism F2's investigation surfaced for why `/metrics` is unauthenticated in the other 14 services). Each scope adds: a `preHandler` that checks `breaker.allowRequest(service)` and, if false, replies `503` immediately without ever attempting the proxy; an `onResponse` that records a success unless the request was already marked as circuit-rejected or proxy-failed; and the existing `onError` (unchanged in its logging/502 behavior) now also calls `breaker.recordFailure(service)`. A `WeakMap<object, 'circuit-rejected' | 'proxy-failed'>` tracks per-request outcome so `onResponse` never misattributes a circuit-rejected request (never forwarded) as a "success," and never infers success/failure from `reply.statusCode` alone (a live, reachable upstream could legitimately return its own 502/503 for unrelated reasons — inferring from status code would be a false signal).

**Business justification:** if one backend service degrades, the gateway now sheds load to it after 5 failures within 10 seconds instead of letting every client request queue up behind a full proxy timeout indefinitely — directly addresses the audit's "Fault Tolerant"/"Resilience" objective and brings the gateway's proxy path in line with how the rest of this platform already treats cross-service calls.

**Technical justification:** reuses Fastify's existing plugin-encapsulation model (no new framework), reuses `@fastify/http-proxy`'s existing `onError` hook (no change to its logged message or 502 envelope shape for genuine failures — only an added side effect), and matches `createCircuitBreaker`'s existing threshold numbers rather than inventing new ones.

**Impact analysis:** a client hitting a healthy service sees no behavior change at all. A client hitting a service that's failing gets the same `502 UPSTREAM_UNAVAILABLE` response for the first 5 failures (identical to before), then a distinct `503 UPSTREAM_UNAVAILABLE` ("circuit open... retry shortly") for the next 30 seconds instead of a fresh proxy attempt each time, then one trial request, then either recovery or another 30s cool-down.

**Regression analysis:** the full 45 pre-existing tests (routing, auth, rate-limit) still pass unchanged, confirming the restructuring into per-upstream child scopes didn't alter existing routing/auth/rate-limit behavior. Two new test files added: `upstream-circuit-breaker.test.ts` (10 unit tests against the state machine directly, using fake timers — closed/open/half-open transitions, window reset, per-service isolation, stuck-probe self-healing) and `gateway-circuit-breaker.test.ts` (2 integration tests against the real `buildGateway()` — confirms the first 5 failures against a genuinely dead upstream get the real 502, the 6th gets the distinct circuit-open 503, and that a different, healthy upstream is completely unaffected by the tripped one). All 47 gateway tests pass; `type-check`, `build`, and `lint` (0 errors) all clean. Also verified end-to-end against the real compiled `dist/` build via a throwaway probe script (not just the test suite), reproducing the exact 5×502-then-503 sequence.

**Files created:**

- `apps/api-gateway/src/upstream-circuit-breaker.ts` — the breaker state machine.
- `apps/api-gateway/src/__tests__/upstream-circuit-breaker.test.ts` — unit tests.
- `apps/api-gateway/src/__tests__/gateway-circuit-breaker.test.ts` — integration tests.

**Files modified:**

- `apps/api-gateway/src/app.ts` — proxy registration restructured into per-upstream child scopes with the breaker's preHandler gate and onResponse/onError tracking hooks.

**Testing performed:** `pnpm test` → 47/47 passed. `pnpm type-check` and `pnpm build` → clean. `pnpm lint` → 0 errors (2 new non-null-assertion warnings, matching the exact same pre-existing style already used in `gateway-routing.test.ts`). Live probe against the compiled `dist/` build.

**Expected result:** a failing upstream stops accumulating unbounded proxy-timeout latency across every request once tripped, and self-recovers via the half-open trial. **Actual result:** confirmed by test and live probe against a deliberately-dead upstream; not yet observed against a real backend service failing under actual production-like load or against a genuinely slow (not just instantly-refused) upstream — `checkUpstream`'s 2s timeout used elsewhere in this file is unrelated to this breaker (that's the `/health` aggregator's own timeout, untouched by this change) and the breaker itself has no explicit per-request timeout of its own beyond whatever `@fastify/http-proxy`'s underlying HTTP client already enforces — worth keeping in mind if a future incident involves a slow-but-technically-responding upstream rather than a cleanly-refused connection.

---

## 11. Implementation Log — F5 and F8 (shipped 2026-07-23), plus final disposition of F4/F6/F7

**F8 — resolved as a confirmed bug, not just an open question.** Direct investigation (a 30MB payload injected straight through `buildGateway()`) proved the gateway imposed **no body-size limit at all** on proxied requests: `@fastify/http-proxy` streams the raw request body straight to the upstream without ever going through Fastify's own `bodyLimit`-enforcing body parser, so setting `bodyLimit` on the gateway's own Fastify instance would have had zero effect (confirmed by testing, not assumed). No service anywhere in this codebase overrides Fastify's own default 1MB `bodyLimit` either (grepped `apps/*/src/main.ts` — zero matches), meaning nothing today can successfully push more than 1MB through any backend service regardless of the gateway — so the fix (a `Content-Length`-based `onRequest` gate at 1MB) doesn't restrict anything that currently works; it just moves the already-effective ceiling to the front door instead of letting an oversized payload consume gateway bandwidth/memory for nothing before a backend would reject it anyway. Known, documented limitation: a chunked-transfer-encoding request (no upfront `Content-Length`) isn't caught by this check and would still stream unbounded — this codebase's normal JSON-body API traffic always sends `Content-Length`, so this is a practical mitigation, not an absolute one.

**F5 — implemented.** Added `@fastify/compress` (new dependency, version `^8.1.0`, resolved via `pnpm install` against the existing Fastify 5 / `@fastify/*` plugin family already pinned in this package). Registered once, globally, at the gateway — no service in this codebase compressed its own responses before this (grepped for `@fastify/compress`/`compress` across every service — zero matches), so this is a net-new capability, not a duplicate of existing per-service behavior. Verified it compresses a proxied streamed response when the client sends `Accept-Encoding: gzip` and leaves it uncompressed otherwise.

**F4 — reassessed, not implemented at the gateway (correction to the original audit).** Investigating further before implementing (rather than assuming the original framing was complete) found that `auth-service` already has real, well-tuned, environment-configurable per-route rate limits on its most brute-force-sensitive endpoints: `login` (`LOGIN_RATE_LIMIT_MAX`, default 10/5min), `forgot-password` (`FORGOT_PASSWORD_RATE_LIMIT_MAX`, default 5/15min), and `lookup-tenants` (`LOOKUP_TENANTS_RATE_LIMIT_MAX`, default 20/5min) — all via Fastify's own per-route `config.rateLimit` mechanism. Adding a second, independently-tuned gateway-level override for the same routes would risk two rate limits for the same logical endpoint drifting out of sync (e.g. an ops team tuning `LOGIN_RATE_LIMIT_MAX` in production without knowing a gateway-side duplicate exists with its own hardcoded numbers) — this is exactly the "second source of truth" anti-pattern PG-001's own Architecture section warns against for permission checks, and the same reasoning applies here. **Not implemented, and shouldn't be** — this part of F4 was already correctly handled at the right layer. What remains true about F4 (no differentiated tier for arbitrary _business_ routes — e.g. an expensive report-export endpoint sharing the same 200/min budget as a cheap lookup) still needs a product decision about which routes qualify, which the gateway architecturally can't infer (no per-route visibility, by design — see PG-001) — left as documented, not built speculatively.

**F6 (load balancing / multi-instance upstreams) — deliberately not implemented.** Building this now would directly contradict this codebase's own existing, documented architecture decision (`ERP-PLANNING/API_VERSIONING.md`): 14 statically-known services, no auto-scaling, explicitly deferred to Kubernetes-readiness work (cluster DNS would replace the static upstream map at that point, which is itself "service discovery for free" without introducing Consul/Eureka). Implementing a bespoke load-balancer now would be exactly the kind of speculative complexity that decision already rejected.

**F7 (access-token revocation is TTL-only) — deliberately not implemented.** This is a real architectural trade-off, not a bug: closing it would require a Redis-backed revocation check on every gateway request, which directly contradicts an existing, explicit "Known Constraint" in PG-001's own design (_"the gateway must remain stateless (no Redis/Postgres dependency) to keep it simple to scale horizontally"_). Building this without an explicit decision to accept that trade-off would be overriding a documented constraint unilaterally — flagging for an explicit product/security decision rather than silently implementing it.

**Files modified (F5/F8):**

- `apps/api-gateway/package.json` — added `@fastify/compress@^8.1.0`.
- `apps/api-gateway/src/app.ts` — added the `Content-Length`-based body-size `onRequest` gate (1MB) and the global `@fastify/compress` registration.
- `apps/api-gateway/src/__tests__/gateway-body-limit.test.ts` — new, 2 tests.
- `apps/api-gateway/src/__tests__/gateway-compression.test.ts` — new, 2 tests.

**Testing performed:** `pnpm test` → 51/51 passed (47 prior + 4 new). `pnpm type-check` and `pnpm build` → clean. `pnpm lint` → 0 errors (1 new non-null-assertion warning matching the exact pre-existing style in `gateway-routing.test.ts`/`gateway-circuit-breaker.test.ts`). Live-verified against the compiled `dist/` build: a 2MB payload now gets `413 PAYLOAD_TOO_LARGE` before reaching the upstream; a gzip-accepting client gets `content-encoding: gzip` on a proxied response, a client with no `Accept-Encoding` gets none.

---

## Summary

Of the 8 findings in this audit (F1–F8), **5 are now implemented and live-verified** (F1, F2, F3, F5, F8). **F4 was reassessed and found already correctly handled at the service layer** for its highest-value case (login/forgot-password/lookup-tenants brute-force protection) — no gateway-side change needed there; a narrower remaining slice (business-route-specific tiers) still needs product input. **F6 and F7 remain deliberately unimplemented**, each because building them now would override an existing, explicit architecture decision already documented elsewhere in this codebase (Kubernetes-deferred load balancing; stateless-gateway constraint vs. token revocation) rather than because they were forgotten — implementing either would need an explicit decision to accept that trade-off first, not a default assumption.
