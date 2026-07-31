# API Gateway — Production Readiness Audit (2026-07-25)

Scope: `apps/api-gateway` — Fastify reverse proxy in front of all 14 backend services.
Method: fresh code read of `app.ts`/`config.ts`/`middleware/gateway-auth.ts`/`upstream-circuit-breaker.ts`, plus live testing against the running stack (gateway on :3000, all 14 services on :3010-3023) using real tenant-2 credentials. Prior audit claims (2026-07-16 gateway cutover, 2026-07-12 CORS bug, 2026-07-23 F1/F3/F5/F8 fixes) were re-verified from scratch, not trusted.

## Summary

The gateway is in materially good shape. All 14 upstreams are routed correctly and were confirmed live (real 200s, not gateway-side 404/502) through the gateway using both `apiV2:true` (rewritten to `/api/v2`) and `apiV2:false` (`report`/`production`/`event`, path passed through unchanged) services, matching `ERP-PLANNING/API_VERSIONING.md`. The previously-severe CORS method-blocking bug (`GET,HEAD,POST`-only default) is confirmed fixed live: preflight and real PUT/PATCH/DELETE all succeed from both frontend origins. Auth (missing/malformed token → 401, valid token → pass-through, per-route permission checks deferred to each service), rate limiting (200/min, tenant-keyed once authenticated, IP-keyed otherwise, verified via both a live induced 429 and the test suite), body-size limiting (1MB, closing a real unbounded-proxy gap), compression, helmet security headers, and a real upstream-aggregating health/readiness endpoint are all live-verified working. All 51 gateway unit tests pass. One real, code-confirmed gap: correlation-ID propagation to upstream silently breaks for the handful of unauthenticated/exempt routes (login, signup, forgot-password, etc.) when the client doesn't already send its own header — exactly the routes most likely to need cross-service debugging. A second, smaller gap: no explicit per-request proxy timeout is configured, so a upstream that hangs (rather than refuses/errors) relies on `@fastify/reply-from`'s undici defaults rather than an intentional, short gateway-level timeout.

## What works (verified live)

- **Routing — all 14 services reachable through the gateway with real data**, not proxy errors:
  - `GET /health` → `200 {"status":"healthy","checks":{...all 14 true...}}`
  - `auth` (`GET /api/auth/users/me` → 200), `tenant` (`GET /api/tenant/organization` → 200), `inventory` (`GET /api/inventory/items` → 200), `sales` (`GET /api/sales/customers` → 200), `notification` (`GET /api/notification/notifications` → 200), `report` (`GET /api/report/api/v2/dashboard/kpis` → 200, real KPI data), `scheduler` (`GET /api/scheduler/jobs` → 200), `search` (`GET /api/search/search` → 200), `gst` (`GET /api/gst/gst/rates` → 200), `accounting` (`GET /api/accounting/accounts` → 200), `purchase` (`GET /api/purchase/purchase-orders` → 200), `hr` (`GET /api/hr/employees` → 200), `production` (`GET /api/production/api/v2/job-work-orders` → 200), `event` (`GET /api/event/api/v2/admin/events/store` → 200).
  - `apiV2:true` vs `apiV2:false` routing convention in `apps/api-gateway/src/config.ts` matches `ERP-PLANNING/API_VERSIONING.md` exactly and was proven live for one of each: `sales` (apiV2:true, caller omits `/api/v2`, gateway rewrites) and `report` (apiV2:false, caller must include `/api/v2` itself after the `/api/report` prefix — confirmed both the "wrong" un-prefixed call 404s and the correctly-prefixed call 200s).
  - Nonexistent gateway prefix → clean gateway-side 404. Valid prefix + nonexistent upstream route → the **upstream's own** 404 body passes through unmodified (`{"message":"Route GET:/api/v2/this-route-does-not-exist-xyz not found",...}`), proving the proxy doesn't swallow or mangle upstream errors.

- **CORS PUT/PATCH/DELETE — the 2026-07-12 bug is fixed and stayed fixed**, verified three ways:
  1. `OPTIONS` preflight to `sales-service` (`Origin: http://localhost:5173`, `Access-Control-Request-Method: PUT`) → `204`, `access-control-allow-methods: GET, HEAD, POST, PUT, PATCH, DELETE`.
  2. Same preflight to `inventory-service` for `DELETE` from `Origin: http://localhost:5174` (pos-frontend) → same allow-list.
  3. **Real** end-to-end mutations, not just preflight: `PUT /api/tenant/organization` (version-checked update) → `200`, version bumped 16→17; `DELETE /api/auth/sessions/:id` (revoked a real extra session) → `200 {"message":"Session terminated"}`. Both round-tripped through the gateway to two different backend services.
  4. Preflight from a disallowed origin (`http://evil.example.com`) correctly omits `access-control-allow-origin`, so a real browser would reject it despite the `204` status — `@fastify/cors`'s normal behavior, working as intended.
  - `ALLOWED_ORIGINS` in `.env`/`.env.example` is `http://localhost:5173,http://localhost:5174,http://localhost:5175` — explicit allowlist, not a wildcard, correctly paired with `credentials: true`.

- **Auth middleware** (`apps/api-gateway/src/middleware/gateway-auth.ts`):
  - Missing Authorization header on a non-exempt route → `401 {"error":{"code":"UNAUTHENTICATED","message":"Missing or invalid Authorization header"}}`.
  - Malformed/garbage token → `401` with `"Invalid or expired access token"`.
  - Valid token → request passes through; confirmed no `x-tenant-id` (or similar) header is injected — each service independently re-verifies the JWT itself (deliberate defense-in-depth per the code comment, since services remain directly reachable on their own ports).
  - Expired-token path is not directly forgeable/live-testable without a real 15-minute wait (RS256-signed by auth-service, no way to mint a pre-expired-but-otherwise-valid token here), but is unit-tested (`gateway-auth.test.ts`: "returns 401 for an expired token", passing) and the underlying `verifyAccessToken` (`packages/platform-sdk/src/auth.ts`) uses `jose`'s `jwtVerify`, which enforces `exp` by default and throws — caught by `gatewayAuthDecorate`'s catch, falling through to the same 401 reject path as a malformed token.
  - Exempt-path list (`EXEMPT_PATHS`/`EXEMPT_PREFIXES`) covers `/health`, `/metrics`, the 8 pre-auth auth-service routes, tenant signup/faqs, and the report unsubscribe-link prefix. `/health` and `/metrics` confirmed reachable with no token.

- **Rate limiting** — configured (`RATE_LIMIT_DEFAULTS`: 200/min, `packages/platform-sdk/src/rate-limit.ts`), tenant-keyed once `request.auth` is populated, IP-keyed otherwise. Live-confirmed: normal requests return `x-ratelimit-limit: 200` / decrementing `x-ratelimit-remaining` headers, and a burst of requests against the shared tenant-2 bucket (this is a shared dev environment — other concurrent sessions appear to hit the same bucket, see Untested section) produced real `429`s that self-cleared on window rollover. All 4 rate-limit unit tests pass, including tenant-isolation and "forged tenantId claim never counts against that tenant" cases.

- **Body size limit** — `MAX_PROXIED_BODY_BYTES = 1MB` onRequest check (`app.ts:71-82`), closing a real gap: `@fastify/http-proxy` streams the body straight to the upstream, bypassing Fastify's own `bodyLimit` entirely. 2/2 tests pass. Documented limitation (in-code comment, confirmed correct): only checks `Content-Length`, so a chunked-transfer-encoding request without a declared length would bypass it — acceptable given this app's traffic is always JSON with `Content-Length` set.

- **Compression** — `@fastify/compress` registered `global: true`; live-confirmed `Accept-Encoding: gzip` → `content-encoding: gzip` on a real proxied response. 2/2 tests pass.

- **Security headers (helmet)** — live response headers include `content-security-policy` (locked to `'self'`), `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`, `cross-origin-opener-policy: same-origin`, `cross-origin-resource-policy: cross-origin` (deliberately not `same-origin` — code comment explains this was previously blocking cross-origin frontend reads entirely, fixed 2026-07-19), and a manually-added `permissions-policy: camera=(), microphone=(), geolocation=()`. Solid for an API-only service.

- **Error handling / upstream-down behavior** — `replyOptions.onError` in `app.ts` returns a clean `502 {"error":{"code":"UPSTREAM_UNAVAILABLE",...}}` rather than hanging or crashing, and feeds the per-upstream circuit breaker (`upstream-circuit-breaker.ts`: 5 failures/10s → open, 30s cooldown, single half-open probe, 10s half-open safety-net timeout — mirrors `packages/platform-sdk/src/circuitBreaker.ts`'s numbers). Once open, further requests to that upstream fast-fail with `503 UPSTREAM_UNAVAILABLE` instead of each queuing a fresh doomed proxy attempt. 2/2 circuit-breaker integration tests + 10/10 unit tests pass. (Did not kill a real service to test this live, per instructions — verified via code + passing tests instead.)

- **Health/readiness** — `GET /health` aggregates all 14 upstreams' own `/health` endpoints (2s timeout each) and returns `200`/`healthy` only if all are up, `503`/`degraded` otherwise (`packages/platform-sdk/src/health.ts`). This is a real aggregating readiness check, not a static "I'm alive" stub.

- **Tests** — `pnpm --filter api-gateway test`: **51/51 pass** across 7 files (routing, auth, rate-limit, body-limit, compression, circuit-breaker x2). Coverage is genuinely broad: exempt paths, SSE query-token fallback, forged-tenant-claim rate-limit isolation, expired/wrong-key tokens, body-limit boundary, gzip compression of a proxied stream, breaker open/half-open/closed transitions.

- **Frontend actually uses the gateway** — both `apps/web-frontend/src/api/client.ts` and every `apps/pos-frontend/src/*.ts` API constant default to `http://localhost:3000` (`VITE_GATEWAY_URL`/`VITE_*_API_URL` env vars, all unset in this environment, so defaults apply) with `/api/<service>` paths. No `.env` override files found in either frontend app that would redirect calls to service ports directly. This matches the 2026-07-16/17 cutover claim and is still true today.

## Bugs/gaps found

### 1. Correlation ID is not forwarded to upstream on unauthenticated/exempt routes when the client doesn't already supply one — Medium

**Description:** `apps/api-gateway/src/app.ts:54` registers `createCorrelationIdHook()` (`packages/logger/src/correlation.ts`) on `onRequest`. That hook reads an existing `x-correlation-id` request header if present, otherwise generates one — but it only sets `request.correlationId` (an internal field) and the _response_ header; it never writes the generated ID back into `request.headers`. The only place that happens is `apps/api-gateway/src/middleware/gateway-auth.ts:78-94` (`gatewayAuthDecorate`), and only inside the `if (!token) return;` guard's else-branch — i.e., **only for requests that already carry a valid Bearer token**:

```ts
export async function gatewayAuthDecorate(request, _reply) {
  const token = extractToken(request, path);
  if (!token) return;                 // <-- exempt/unauthenticated routes stop here
  try {
    request.auth = await verifyAccessToken(token);
    const correlationId = (request as ...).correlationId;
    if (correlationId) {
      request.headers['x-correlation-id'] = correlationId;   // only reached with a valid token
    }
  } catch { ... }
}
```

Since `@fastify/http-proxy` forwards `request.headers` as-is at proxy time, any request to an exempt/unauthenticated route (`/api/auth/auth/login`, `/signup`, `/forgot-password`, `/reset-password`, `/mfa/verify`, `/refresh`, `/logout`, `/tenant/public/signup`, `/tenant/public/faqs`) that doesn't already carry its own `x-correlation-id` header reaches the upstream service with **no** correlation header at all. Since every service (confirmed for `auth-service`, `apps/auth-service/src/main.ts:119`) independently runs the same `createCorrelationIdHook()`, the upstream then generates its **own**, different correlation ID for its internal logs — silently breaking gateway-log-to-service-log correlation for exactly the routes (login, signup, password reset) most likely to need it when debugging a real incident.

**Evidence:** Code at `apps/api-gateway/src/middleware/gateway-auth.ts:78-94` and `packages/logger/src/correlation.ts:12-22`. Live-confirmed the client-visible symptom is masked when a client already sends the header (tested by supplying `x-correlation-id: CLIENT-SUPPLIED-LOGIN-TEST-456` on `POST /api/auth/auth/login` — value passed through unchanged, because it was already present in `request.headers` before any gateway logic ran, so this doesn't exercise the actual code path). Could not fully live-confirm the upstream-side mismatch (gateway's live stdout/log destination in this shared dev environment couldn't be located — `tmp-logs/api-gateway.log` and `/tmp/api-gateway.log` both appear to be stale/from a different run than the currently-listening process) — this finding is code-verified, not log-verified end-to-end.

**Business impact:** Not a security or correctness bug — logins/signups/password-resets still work. It's an observability gap: an on-call engineer correlating a "login failed" ticket by the correlation ID shown to the user/frontend will not find matching log lines in auth-service's logs for exactly the pre-auth flows where that kind of correlation matters most.

**Fix sketch:** In `gatewayAuthDecorate` (or better, directly in the `createCorrelationIdHook` usage in `app.ts`), always write the resolved correlation ID into `request.headers['x-correlation-id']` on `onRequest`, unconditionally — not gated behind token presence.

### 2. No explicit per-request proxy timeout configured — Low/Medium

**Description:** `apps/api-gateway/src/app.ts`'s `httpProxy` registration (lines 186-203) passes `upstream`, `prefix`, `rewritePrefix`, and `replyOptions.onError`, but no `timeout` option. `@fastify/http-proxy` delegates to `@fastify/reply-from`, which does accept a `timeout` option and surfaces `GatewayTimeoutError`/`UND_ERR_HEADERS_TIMEOUT` through the same `onError` path used for genuinely down upstreams (confirmed by reading `node_modules/.pnpm/@fastify+reply-from@12.6.2/.../index.js`) — so a timeout _would_ be handled cleanly (502 + circuit-breaker failure) if one fired. But with no explicit `timeout` set, the effective timeout is whatever undici's own defaults are (typically on the order of minutes), which is much longer than reasonable for this app's APIs. A genuinely _hung_ (not down — no connection refusal, no error, just never responding) upstream would tie up the connection far longer than a fast-fail circuit-breaker design implies, and the breaker itself never sees a failure to count until that long default timeout eventually elapses.

**Evidence:** `apps/api-gateway/src/app.ts:186-203` (no `timeout` in the `httpProxy` options); `UPSTREAM_HEALTH_TIMEOUT_MS = 2000` (line 23) is only used for the separate `/health` check, not the actual proxy path.

**Business impact:** Low under normal conditions (real outages in this codebase manifest as connection-refused, which fails fast); becomes relevant only for a slow-death/hung-process failure mode, which is a real but less common production scenario.

**Fix sketch:** Pass an explicit `timeout` (e.g. matching the health-check's 2-10s ballpark, or whatever this app's slowest legitimate endpoint needs) in the `httpProxy` registration options.

## Untested/unknown areas

- **Jaeger tracing**: `initializeTelemetry()` is called in `apps/api-gateway/src/main.ts:6` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` is set in `.env`, so the code path for exporting spans is wired. However, **Jaeger is not actually running in this environment** — `docker ps` shows only postgres/kafka/elasticsearch/redis/minio/zookeeper/mailhog; no `jaeger` container, and `curl http://localhost:16686/api/services` fails with connection-refused. The task brief stated Jaeger was up; it was not, in practice, at audit time. Could not verify whether spans actually reach Jaeger or whether trace context propagates from gateway to upstream services.
- **Prometheus/Grafana**: also not running (`docker ps` doesn't list them), so `/metrics`'s actual scrape-ability by a live Prometheus instance wasn't verified end-to-end (the endpoint itself does return metrics text — that part is confirmed).
- **Correlation-ID upstream-log mismatch** (Finding 1): code-verified, not confirmed against live logs — see above.
- **True upstream-down (502) behavior**: verified via code + passing unit/integration tests, not via live-killing a real service, per the task's explicit instruction not to.
- **Shared-environment rate-limit interference**: while testing, the tenant-2 rate-limit bucket appeared to be consumed faster than this session's own request volume justified (200/min limit hit after roughly 20-30 of this session's own requests on more than one occasion, then recovered), consistent with the known "concurrent sessions on the same repo" pattern noted elsewhere in this project's history — plausibly another live session hitting the same tenant's bucket concurrently. This did not block verification (a 429 was captured and is itself confirmation the limiter works) but means the exact throughput this session measured isn't a clean single-actor number.

## Readiness score: 85/100

**Justification:** Every piece of gateway-owned infrastructure explicitly called out in the brief — routing to all 14 services, the historically-severe CORS method block, auth accept/reject, rate limiting, body-size limiting, compression, helmet headers, clean error passthrough/circuit-breaking, aggregating health checks, and frontend cutover — is live-verified working, backed by a genuinely broad passing test suite (51/51). Deductions: the correlation-ID gap on pre-auth routes is a real, code-confirmed observability defect that will bite exactly when it's needed most (incident debugging); the missing explicit proxy timeout is a smaller robustness gap; and two of the observability dependencies this audit was asked to check (Jaeger, Prometheus) simply weren't running, leaving tracing/metrics-scraping unverified rather than confirmed-good. None of the found issues are correctness- or security-critical, which is why the score stays in the mid-80s rather than lower.
