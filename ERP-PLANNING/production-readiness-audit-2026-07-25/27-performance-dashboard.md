# Performance Dashboard — Production Readiness Audit (2026-07-25)

Scope: `apps/web-frontend/src/pages/admin/distributed/PerformancePage.tsx` +
`apps/event-service/src/api/performance.routes.ts` (`performance_profiles` table,
`packages/db-client/src/schema/distributed.ts`).

## Summary

**This feature does not depend on Prometheus or Jaeger at all** — that was the working
assumption going in (based on two sibling audits today finding those containers down), and
it does not hold for this feature. "Performance Baselines" is a self-contained
event-service feature: a Postgres table (`performance_profiles`) that is only ever written
to by `POST /admin/performance/samples`, and the only caller of that route anywhere in the
repo is the k6 load-test harness (`load-tests/k6-helpers.js` → `reportSamplesToEventService`).
There is no Prometheus scrape, no `/metrics` aggregation, and no automatic instrumentation of
real request traffic feeding this table. So the Prometheus-down environment fact is
irrelevant here — verified live end-to-end (login → gateway → event-service → Postgres) and
it all works. Both `GET .../performance/baselines` and `GET .../performance/targets` return
200 through the gateway with a real bearer token.

The actual gap is different and more fundamental: the dashboard is a **viewer for
manually-run k6 load-test results**, not a live performance-monitoring dashboard. In this
dev environment nobody has run a k6 load test against this DB recently, so `baselines` is
empty and the page renders its clean "No baseline measurements recorded yet" empty state —
correctly, not broken. But even when populated, the data model is broken: each `POST
/samples` call inserts exactly one raw sample as `p95Ms` and never populates `p50Ms` or
`p99Ms` (confirmed live — see Bugs #1). The route selects the single latest row per
endpoint+method (`SELECT DISTINCT ON ... ORDER BY measured_at DESC`), not an aggregated
percentile across a sample window, despite `sampleCount` implying an aggregate. This is a
code gap, not an infra gap — no amount of starting Prometheus/Jaeger containers would fix it.

RBAC and route wiring are solid (live-verified). Auto-refresh is sane. The one dedicated
automated test file covering this route's permission enforcement is 100% broken (20/20
failing) due to an unrelated SDK issuer-check change, not a bug in the feature itself — but
it means there is currently zero effective regression coverage for RBAC on this route.

**Readiness: 45/100** — the plumbing (route, RBAC, empty-state, gateway routing) is solid
and live-verified, but the core feature (percentile latency baselines) is not actually
implemented — it stores single raw samples and mislabels them as P50/P95/P99, and nothing
in the running application ever produces data for it outside manual k6 runs.

## What works (live-verified)

- **Gateway routing**: `GET /api/event/api/v2/admin/performance/baselines` and
  `.../targets` both return `200` with `{"data": [...]}` through the gateway with an OWNER
  token. (Note: event-service is `apiV2: false` in gateway config, so the full path is
  `/api/event/api/v2/admin/...` — confirmed by reading `apps/api-gateway/src/config.ts` and
  `apps/web-frontend/src/api/client.ts`, then live-testing.)
- **RBAC enforcement, live-verified both directions**:
  - OWNER (has `PERFORMANCE_VIEW`) → `200`.
  - CASHIER (no `PERFORMANCE_VIEW`) → `403 {"code":"FORBIDDEN","message":"Missing permission: PERFORMANCE_VIEW"}`.
  - No token → `401`.
- **RBAC breadth is intentional, not accidental**: `PERFORMANCE_VIEW` (along with
  DLQ/Saga/SchemaRegistry/Projection/EventStore _VIEW) is granted to `ACCOUNTANT`,
  `ACCOUNTANT_SUPERVISOR`, and `AUDITOR` in `apps/tenant-service/src/rbac/role-defaults.ts`
  (lines ~265, ~466, ~519), each with an explicit "PG-015: read-only visibility into the
  distributed-systems admin consoles" comment. So this is **not** admin/platform-operator
  tier only — it's deliberately exposed read-only to finance/audit roles too. That's a
  documented design decision, not a bug, but worth flagging since the task brief assumed
  platform-admin-only.
- **Frontend route/permission gating wired correctly**: `App.tsx:2340` guards
  `/admin/distributed/performance` behind `PermissionRoute` with `PERFORMANCE_VIEW`; nav
  entry (`navigation.ts:758-763`) uses the same constant. No dead-permission-constant bug
  (a recurring pattern class in this codebase per project memory) — verified match.
  Backend route (`performance.routes.ts:32,72`) also uses `PERMISSIONS.PERFORMANCE_VIEW`
  consistently for both GET routes.
  - Curiosity, not a bug: `POST /samples` (recording a sample) is gated on the same
    `PERFORMANCE_VIEW` "view" permission rather than a "manage/write" permission — so any
    role that can view baselines can also inject arbitrary latency numbers into them. Low
    severity since this is a load-test recording endpoint, not sensitive data, but the
    naming is misleading.
- **Empty state**: with zero rows in `performance_profiles`, the page renders
  `ERPEmptyState` ("No baseline measurements recorded yet / Latency measurements will
  appear here once endpoints are exercised") instead of crashing or showing misleading
  blank charts. Confirmed correct behavior for the current (empty) dev DB state.
- **No hardcoded/demo/mock numbers in the frontend**: all four summary tiles (Endpoints
  Tracked, Targets Configured, P95 Breaches, Within Target) are derived from live query
  results (`baselines.length`, `targets.length`, computed `breachCount`) — no stubbed
  numbers found on inspection of `PerformancePage.tsx`.
- **Targets list is real and matches the backend's hardcoded `TARGETS` map**: 4 endpoints
  (`POST /api/v2/invoices/confirm` 500ms, `GET /api/v2/dashboard/kpis` 200ms,
  `GET /api/v2/items/by-barcode` 50ms, `GET /api/v2/customers/search` 200ms) — confirmed
  identical between `performance.routes.ts:11-16` and the live `GET .../targets` response.
- **Auto-refresh is reasonable**: `baselines` query polls every 60s via
  `refetchInterval: 60_000` (react-query manages cleanup on unmount automatically, no leak
  risk); `targets` query has no polling (fetched once, correct — targets are static
  config). No error-loop risk reasoned from the code: a failed fetch just leaves
  `isLoading`/cached data alone under react-query defaults.

## Bugs / gaps found

### 1. HIGH — P50 and P99 columns render the literal string "nullms" for every real row; percentiles are never actually computed

**Evidence (live-verified)**: POSTed a real sample via
`POST /api/event/api/v2/admin/performance/samples` with `{"endpoint":"/api/v2/dashboard/kpis","method":"GET","durationMs":123}`
→ `201`. Subsequent `GET .../baselines` returned:

```json
{
  "endpoint": "/api/v2/dashboard/kpis",
  "method": "GET",
  "p50Ms": null,
  "p95Ms": 123,
  "p99Ms": null,
  "sampleCount": 1,
  "targetP95Ms": 200,
  "measuredAt": "...",
  "meetsTarget": true
}
```

`p50Ms`/`p99Ms` are `null` because `performance.routes.ts:98-105`'s insert only ever sets
`p95Ms: durationMs` — `p50Ms` and `p99Ms` are never populated by any code path in the repo.
`PerformancePage.tsx:31-33`'s `formatMs()`:

```ts
function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}
```

With `ms = null`: `null >= 1000` is `false` (JS coerces `null` to `0`), so it falls through
to the template literal, producing the literal string `"nullms"` in the P50 and P99 table
cells. This is a guaranteed rendering bug for every single row the page will ever display —
not an edge case. **Business impact**: an admin/auditor looking at this page for any
populated data would see "nullms" in two of the three headline latency columns, making the
page look broken/unfinished, and P50/P99 are simply never usable data.

### 2. HIGH — "baseline" is a single raw sample, not an aggregated percentile; `sampleCount` is always 1 and is misleading

`performance.routes.ts:38-39`'s baselines query is
`SELECT DISTINCT ON (endpoint, method) ... ORDER BY endpoint, method, measured_at DESC` —
this returns only the single most recent row per endpoint+method, and each row is one raw
`durationMs` from one request (`sampleCount: 1` is hardcoded at insert time,
`performance.routes.ts:102`). There is no code anywhere that computes an actual p50/p95/p99
across a window of samples. So even under ideal conditions (k6 load test run, hundreds of
samples posted), the dashboard would show only the very last sample's raw duration labeled
as "P95", with "Samples: 1" — not a statistically meaningful percentile over the run. This
contradicts the page's own subtitle ("P50/P95/P99 latency measurements") and the "Samples"
column's implication of an aggregate count. **Business impact**: even in the intended
manual-load-test-review workflow, the reported "P95" is not a real P95 — it's whatever the
last request in the run happened to take, which could be an outlier in either direction.
This is a data-integrity/correctness gap in the feature's core purpose.

### 3. MEDIUM — Feature is not a live performance dashboard; nothing in normal request traffic ever populates it

No service instrumentation (gateway, individual services) posts to
`/admin/performance/samples` during normal operation — the only caller found anywhere in
the codebase is `load-tests/k6-helpers.js`. So outside of someone manually running a k6
script against this specific dev DB, `performance_profiles` stays empty forever and the
page permanently shows the empty state. This is architecturally fine as a "load-test result
viewer" but is presented in the nav/UI as a general "Performance" admin console
(`Gauge` icon, `/admin/distributed/performance`), which will read as broken/unmonitored to
anyone expecting live latency telemetry (the two sibling audits' Prometheus/Jaeger findings
suggest that expectation exists elsewhere in this admin area). Confirmed: this environment's
`performance_profiles` table was empty before this audit's own test insert.

### 4. MEDIUM — The one automated test for this route's RBAC is 100% broken (20/20 failing), providing zero effective regression coverage

`apps/event-service/src/__tests__/permission-granularity.test.ts` (covers DLQ/Saga/Schema
Registry/Projections/Event Store/**Performance**, 20 tests total) fails all 20 tests with
`expected ... to be ...` mismatches rooted in `401` responses. Root cause: the test's
`makeToken()` signs with `.setIssuer('erp-test')`, but
`packages/platform-sdk/src/auth.ts:31-32`'s `verifyAccessToken()` now enforces
`jwtVerify(token, publicKey, { algorithms: ['RS256'], issuer: process.env['JWT_ISSUER'] ?? 'erp-auth-service' })`
— an issuer check added as defense-in-depth (per its own comment) that this test file was
never updated for. Every request in the suite fails signature/issuer verification and gets
`401` before permission logic is ever exercised, including the 2 tests specifically named
`'Performance' permission boundary`. This is **not** a bug in the Performance Dashboard
feature itself (live curl testing above confirms the real RBAC works correctly end-to-end),
but it means the codebase currently has no passing automated test proving
`PERFORMANCE_VIEW` enforcement, and the same is true for the other 5 admin consoles this
file covers. Command run: `npx vitest run src/__tests__/permission-granularity.test.ts`
from `apps/event-service` → `20 failed (20)`.

### 5. LOW — No frontend tests for `PerformancePage.tsx`

No test file matching `PerformancePage`/`performance` under `apps/web-frontend` was found.
No coverage of the empty-state path, the `formatMs(null)` bug above, or the breach-count
badge logic.

## Not a bug (confirms task's Prometheus concern doesn't apply here)

Verified via `docker ps` that Prometheus/Jaeger/Grafana containers are indeed not running in
this dev environment (consistent with the API Gateway and Event Service audits from earlier
today), and confirmed this feature has zero dependency on them — it reads only from
event-service's own Postgres table via a normal Fastify route, which works end-to-end
regardless of Prometheus/Jaeger state.

## Readiness score: 45/100

- Routing, gateway wiring, and RBAC: fully correct and live-verified (would score high alone).
- Empty state: clean, correct, no crash/hang.
- Core data model (percentile computation) is not implemented — every populated row will
  visibly render "nullms" for 2 of 3 headline metrics, and the one metric that does render
  (P95) is a single raw sample mislabeled as a percentile, not an aggregate.
- No live/automatic data source — entirely dependent on someone manually running k6 against
  this exact DB; in this environment, the table has effectively never been populated by real
  usage.
- Zero passing automated test coverage for the feature's authorization boundary.

Fixing this requires code changes (aggregate incoming samples into real p50/p95/p99 over a
rolling window before insert or on read, fix `formatMs` to handle `null`, decide whether
`POST /samples` should be wired into real request middleware for at least the 4 tracked
endpoints instead of relying solely on manual k6 runs) — not infrastructure changes.
