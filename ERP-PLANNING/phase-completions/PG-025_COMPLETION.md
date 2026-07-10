# PG-025 — Centralized Log Aggregation (Loki) Rollout — Completion Report

**Date:** 2026-07-10
**Status:** Code/config deliverables complete. **Live end-to-end verification not run** — see §Deployment Checklist.

## Summary

The Winston-side `LokiTransport` (`packages/logger/src/loki-transport.ts`) was already
complete, correct, production-quality code — it was simply never instantiated anywhere.
Closed the gap: deployed Loki (docker-compose `loki` service + a new
`infrastructure/k8s/loki.yaml`), wired `lokiUrl: process.env['LOKI_URL']` into all 14
services' `createLogger(...)` calls, provisioned a Grafana Loki datasource, and — a
scope addition the doc flagged as conditional — discovered `createCorrelationIdHook()`
was **fully unused** (not partially wired, as the doc hedged) and wired it into all 14
services' `onRequest` hook plus their shared error-handler log call.

Docker Desktop was not running in this session (confirmed via `docker ps`), so the
actual "log line appears in Grafana Explore" acceptance criterion was **not** run live.
Everything checkable statically was: `docker compose config --quiet` (clean),
`kubectl kustomize infrastructure/k8s/` (clean, confirms `loki.yaml` resources render
correctly in the `erp-infra` namespace), YAML parse of every new/changed config file, and
`tsc --noEmit` + a new Vitest suite for the transport itself, all passing.

## Files Changed

- `docker-compose.yml` — new `loki` service (`grafana/loki:3.3.2`, filesystem storage,
  exposed on `3100`), new `loki_data` volume, Grafana's `depends_on` extended to wait on
  Loki's healthcheck. No Promtail — every service already pushes logs directly via
  `LokiTransport`, so a log-file-tailing sidecar would be redundant.
- `infrastructure/docker/loki/loki-config.yaml` — **new**; filesystem storage, TSDB
  schema v13, matching this stack's existing "no object storage in local dev" convention
  (Prometheus/Grafana).
- `infrastructure/docker/grafana/provisioning/datasources/loki.yaml` — **new**, alongside
  the existing `prometheus.yaml`; Loki appears in Grafana Explore with zero manual setup.
- `infrastructure/k8s/loki.yaml` — **new**; ConfigMap + PVC + Deployment + Service, in the
  `erp-infra` namespace (see judgment call below — not `erp-system`).
- `infrastructure/k8s/kustomization.yaml` — added `loki.yaml` to the `resources:` list.
- `.env` / `.env.example` — new `LOKI_URL=http://localhost:3100` (see judgment call below
  on why this is `localhost`, not `loki:3100`).
- All 14 `apps/*/src/main.ts` (accounting, auth, event, gst, hr, inventory, notification,
  production, purchase, report, sales, scheduler, search, tenant):
  - `lokiUrl` (conditionally spread, since `exactOptionalPropertyTypes: true` rejects
    `lokiUrl: string | undefined` directly — see `[[erp-empty-state-exact-optional]]`
    for the same gotcha elsewhere in this codebase) passed into `createLogger(...)`.
  - `createCorrelationIdHook()` registered as an `onRequest` hook, right after each
    service's `Fastify(...)` instantiation.
  - The correlation ID added to each service's existing `setErrorHandler` catch-all log
    call (`(request as { correlationId?: string }).correlationId`).
- `packages/logger/package.json` — added `test`/`test:coverage` scripts and
  `vitest`/`@vitest/coverage-v8` devDependencies (package had no test infrastructure at
  all before this).
- `packages/logger/vitest.config.ts` — **new**, matching `packages/config`'s config
  exactly (same coverage thresholds, same `environment: 'node'`).
- `packages/logger/src/__tests__/loki-transport.test.ts` — **new**; 4 tests covering
  batch-threshold flush, non-2xx requeue, network-error requeue, and that `log()`'s
  winston callback fires synchronously (never blocks on the network call).

## Design notes / judgment calls

- **`createCorrelationIdHook` was fully unused, not partially wired.** The gap-prompt's
  own wording hedged ("verify whether it's already threaded... or whether it's missing").
  Grep across every `apps/*/src` found zero call sites. Scoped the fix to what's
  mechanically contained: register the hook (captures/generates the ID, echoes it on the
  response header) and thread it into the one framework-wide log call every service
  already has — `setErrorHandler`. Did **not** attempt to thread correlationId into every
  individual `logger.info/error(...)` call across the ~90 route files in this codebase —
  since every service uses one shared, non-request-scoped `logger` instance (not
  Fastify's per-request `request.log`), doing that properly means touching every route
  file, which is a different, much larger piece of work than this prompt's stated "M"
  complexity (see `[[es22_c9_scope_explosion]]` for what happens when a prompt's assumed
  scope turns out to be 100x bigger than stated). Flagged as a real follow-up below, not
  silently solved.
- **`LOKI_URL=http://localhost:3100`, not `http://loki:3100`, for local dev.** Confirmed
  via `infrastructure/docker/prometheus/prometheus.yml`'s existing
  `host.docker.internal:<port>` scrape targets that backend services run on the **host**
  via `turbo`/`tsx`, not as docker-compose containers — only infra runs in
  docker-compose. The container-name form (`http://loki:3100`) is only correct for
  Grafana's own datasource config, since Grafana itself *is* a docker-compose container.
- **`infrastructure/k8s/loki.yaml` deploys into `erp-infra`, not `erp-system`.** All 14
  existing service manifests already set `LOKI_URL=http://loki.erp-infra.svc.cluster.local:3100`,
  but those same manifests deploy into `erp-system` (confirmed in `namespace.yaml`, which
  already declares both namespaces even though nothing was previously deployed into
  `erp-infra`). Putting Loki in `erp-system` would leave that existing hostname pointing
  at nothing.
- **Loki-only, no Promtail** — per the gap-prompt's own recommendation, confirmed correct:
  every service already pushes structured logs directly via `LokiTransport`, so a
  log-file-tailing scrape sidecar would duplicate work already done at the application
  layer.
- **`correlationId` is a log-line field, not a Loki label** — per the gap-prompt's own
  explicit correction (Loki label cardinality must stay low: `service`/`env`/`level`
  only). Nothing in this implementation adds it as a label; it only appears inside the
  JSON log body, same as it always did in `defaultMeta`.

## Tests Added + Results

- `packages/logger/src/__tests__/loki-transport.test.ts` — **4/4 passing**
  (`pnpm --filter @erp/logger test`). Covers: flush triggers once `batchSize` is reached
  and posts the correct Loki push-API shape; a non-2xx response re-queues the entry
  rather than dropping it (verified via a direct `flush()` call for determinism, since
  `batchSize`-triggered auto-flush only pulls `batchSize` entries per call — an
  auto-triggered version of this test was tried first and gave a spurious failure for
  that reason, not a real bug); same for a network error (`fetch` rejecting); the
  winston `callback` fires synchronously, confirming logging never blocks on the Loki
  network call.
- `tsc --noEmit` clean on all 14 changed services (each run individually via
  `pnpm --filter <service> exec tsc --noEmit`).
- `eslint src/` on `packages/logger` shows the same pre-existing `no-undef`
  (`process`/`fetch`/`setTimeout`/etc.) errors this package already had before this
  change, plus the same category in the new test file (missing ESLint globals config,
  not a real bug — see `[[preexisting_lint_debt]]`); fixed the one genuine warning in the
  new file (`explicit-function-return-type`).
- `docker compose config --quiet` — clean (no live daemon; Docker Desktop was down all
  session, confirmed via `docker ps`).
- `kubectl kustomize infrastructure/k8s/` — clean; confirmed by grep that all 4 new
  Loki resources (ConfigMap, PVC, Deployment, Service) render in the `erp-infra`
  namespace as expected.
- Every new/changed YAML file parsed successfully with Python's `pyyaml` (no live
  cluster available to `apply --dry-run` against).

## Deployment Checklist

- [ ] **Start the Loki container**: `docker compose up loki` (or the full stack) and
      confirm `curl http://localhost:3100/ready` returns `ready`. Not run this session
      — no live Docker daemon available.
- [ ] **Confirm a real log line reaches Grafana Explore** within the transport's ~2s
      flush interval, once the stack above is running — this is PG-025's core acceptance
      criterion and was not verified end-to-end here.
- [ ] **`kubectl apply -k infrastructure/k8s/`** against a real cluster once one exists
      (per `[[pg022_session1_helm_chart]]`, no cluster has been deployed against yet in
      this project) — confirms the `erp-infra` Loki Service actually resolves at
      `loki.erp-infra.svc.cluster.local` for the 14 app services in `erp-system`.
- [ ] **Follow up on per-route correlationId propagation.** Only the shared
      `setErrorHandler` catch-all carries `correlationId` today. If cross-service search
      by correlation ID needs to work for *successful* requests too (not just the
      unhandled-error boundary), that requires either migrating each service off its
      single shared `logger` instance to Fastify's per-request `request.log`, or passing
      `request.correlationId` explicitly into the ~90 route files' own log calls — a
      separate, larger piece of work, not done here.

## Phases Unblocked

None directly (`Depends on: none`, `Blocks: none` per the originating brief). PG-022
(Kubernetes/Helm) is a named integration point — `infrastructure/k8s/loki.yaml` was
added to `kustomization.yaml` alongside the existing resources so PG-022's chart work
picks it up rather than needing a divergent Loki manifest of its own.
