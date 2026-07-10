# PG-005 — Postgres Read-Replica Utilization — Completion Report

**Date:** 2026-07-10
**Status:** Complete for the scope this prompt actually supports. Search-service's
"reindex" leg was descoped after tracing the real code path — see below.

## Summary

Wired the previously-unused `createReadReplicaClient()` (`packages/db-client`) into
report-service via a new lag-aware `ReplicaRouter`. Report definitions (`ReportEngine`'s 60
report cases, 78 `db.execute` call sites) and all four `dashboard.routes.ts` handlers
(kpis/charts/alerts/pos-analytics) now read from the replica when it's healthy, falling back
to the primary automatically when replication lag exceeds a per-caller threshold or the
replica connection fails. No write path was touched anywhere.

Re-verified the doc's own standing instruction before starting: `createReadReplicaClient` still
had zero callers repo-wide.

**Search-service was not wired in** — tracing the actual reindex path
(`apps/scheduler-service/src/jobs/searchSyncJobs.ts`/`searchSyncSources.ts`) showed the bulk
reads happen in 7 *other* owning services (sales/inventory/purchase/accounting/hr/auth/tenant),
not in search-service itself; search-service's own DB access is `dlq_items` writes plus small
admin reads that need read-your-write consistency. See
`ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md`'s PG-005 entry for the full trace.
Routing those 7 services' internal search-sync reads through the replica is a real, valid
follow-up but is out of this M-complexity prompt's stated scope ("no other service is in scope
for this pass").

## Files Changed

- `packages/db-client/src/replica-health.ts` — **new**; `isReplicaHealthy(replicaDb, maxLagMs)`
  runs `pg_last_xact_replay_timestamp()`, returns `false` (never throws) on lag-over-threshold,
  connection failure, or a `NULL` result (not currently replicating).
- `packages/db-client/src/replica-router.ts` — **new**; `ReplicaRouter` wraps a primary+replica
  pair, caches the health check for `healthCacheMs` (default 1s) to avoid doubling query volume
  on the replica, and calls an optional `onFallback()` callback each time it falls back to
  primary.
- `packages/db-client/src/index.ts` — exports both.
- `packages/db-client/package.json` / new `vitest.config.ts` — added `vitest`/`test` script
  (this package had no test infra before).
- `packages/db-client/src/__tests__/replica-router.test.ts` — **new**; 9 tests covering healthy
  replica, lagging replica (falls back, doesn't throw), connection failure (falls back, doesn't
  throw), health-check caching, and cache expiry.
- `packages/logger/src/erp-metrics.ts` / `index.ts` — new `erpReplicaFallbackTotal` counter
  (`erp_replica_fallback_total{service}`), following this file's existing
  `getOrCreateCounter()` pattern rather than adding `prom-client` as a new dependency of
  `packages/db-client`.
- `apps/report-service/src/domain/ReportEngine.ts` — constructor takes an optional
  `ReplicaRouter`; `runQuery()` resolves `db = replicaRouter ? await replicaRouter.forRead() :
  this.db` once per call, then all 78 pre-existing `this.db.execute(sql\`...\`)` sites were
  mechanically renamed to `db.execute(...)` (verified via grep — every one of the 78 sites was
  inside `runQuery`, nothing else in the file referenced `this.db`).
- `apps/report-service/src/api/dashboard.routes.ts` — `dashboardRoutes()` takes an optional
  `ReplicaRouter`; each of the 4 handlers resolves its own `readDb` (per-request, since
  `forRead()` is async) and all 22 `db.execute` sites were renamed to `readDb.execute`.
- `apps/report-service/src/api/analytics-reports.routes.ts` — `analyticsReportsRoutes()` takes
  an optional `ReplicaRouter`, passed straight through to `new ReportEngine(db, redis,
  replicaRouter)`.
- `apps/report-service/src/main.ts` — constructs `replicaDb` via `createReadReplicaClient({ url:
  config.databaseReplicaUrl })` (already resolved by `@erp/config`, no change needed there) and
  two `ReplicaRouter` instances: `reportReplicaRouter` (default 5s lag threshold) for report
  definitions, `dashboardReplicaRouter` (120s) for dashboards, matching
  `projection_dashboard_daily`'s existing `STALE_TOLERANCE_MS` in event-service's
  `projections.routes.ts`. `report.routes.ts`'s separate internal `ReportEngine` instance
  (PDF/outstanding-summary emails, service-to-service, low volume) was **not** given a router —
  left on primary, out of the doc's stated priority list.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-005 entry documenting
  the search-service scope correction above.

## Design notes / judgment calls

- `ReplicaRouter` does not import `prom-client` directly — `packages/db-client` has never
  depended on `@erp/logger` (or vice versa), and adding that just for one counter would be a new
  cross-package dependency for a package that's otherwise a thin DB-client wrapper. Instead it
  takes an `onFallback?: () => void` callback; report-service supplies one that increments
  `erpReplicaFallbackTotal` in `@erp/logger`'s already-existing central metrics module.
- `dashboardRoutes()`'s `/pos-analytics` handler (POS_MANAGE-gated live sidebar data) was
  included under the same 120s dashboard threshold as the other 3 handlers rather than carved
  out to stay on primary. It lives in the same file the doc names as priority-2 scope
  ("dashboard.routes.ts... live-computed KPI/chart queries") and the lag-aware fallback means it
  only actually serves stale data if the replica is genuinely behind by more than 2 minutes —
  in practice this is a rare degrade path, not a routine one.
- Two separate `ReplicaRouter` instances share one `db`/`replicaDb` connection pair (cheap —
  `ReplicaRouter` itself holds no connection state, just the two client references, options, and
  a cached boolean) rather than a single shared instance with a runtime-overridable threshold, to
  keep the "per-query-type threshold" behavior the doc asks for straightforward and free of a
  mutable-config footgun.

## Tests Added + Results

- `packages/db-client/src/__tests__/replica-router.test.ts` — 9/9 passing (`pnpm --filter
  @erp/db test`): healthy replica routes to replica; lagging replica falls back without
  throwing; replica connection failure falls back without throwing; `lag_ms: null` treated as
  unhealthy; health-check result cached within the window; re-checked after the window expires.
- `pnpm --filter @erp/db build` / `pnpm --filter @erp/report-service type-check` — both clean.
- `pnpm --filter @erp/report-service test` — all 118 pre-existing tests (financial reports,
  ar/ap-aging, tenant isolation, scheduled reports, number series) still pass unchanged,
  confirming the mechanical `this.db` → `db` rename in `ReportEngine.runQuery` didn't alter
  query behavior.
- **Not run:** the doc's own "confirm `erp-postgres-replica` receives read traffic via
  `pg_stat_activity`" manual verification — no live Docker/Postgres this session (see
  [[es24_no_live_db_available]]-style caveat; same constraint as several recent sessions). The
  fallback-counter increment path is covered by the unit test's `onFallback` assertions instead.

## Deployment Checklist

- [ ] **Provision `DATABASE_REPLICA_URL` with a read-only Postgres role** for the replica
      connection, per the gap-prompt's own Security section — this package assumes that
      infra-level hardening exists but does not enforce it in code. Until done, the replica
      connection has the same write privileges as primary (harmless today since this package
      never issues writes through it, but worth closing before relying on this as a security
      boundary).
- [ ] **Confirm `erp-postgres-replica` is actually streaming** in every real environment this
      deploys to — `isReplicaHealthy()` degrades gracefully (falls back to primary) if it isn't,
      so a broken replica fails safe, but that also means a silently-broken replica produces no
      user-visible symptom other than `erp_replica_fallback_total` climbing. Alert on that metric
      once Grafana/Alertmanager dashboards are updated (not part of this pass).
