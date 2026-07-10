# [PG-025] Centralized Log Aggregation (Loki) Rollout

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Infrastructure
**Priority:** Medium
**Complexity:** M — the Winston-side Loki transport is already fully implemented; the work is deploying Loki/Promtail, wiring the already-existing transport's `lokiUrl` option through from env vars (currently never passed), and Grafana Explore integration.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `packages/logger/`, `docker-compose.yml`, `infrastructure/k8s/`, all 14 backend services' `main.ts` bootstrap

---

## Overview

- **Business objective:** Today, if an engineer needs to trace a request across services (e.g., "why did invoice X's outbox event never reach accounting-service?"), the only cross-service correlation tool is Jaeger traces — useful for latency/span structure, but not for reading actual structured log messages (error details, business-rule rejection reasons, validation failures) across services in one place. Each service's logs are stdout-only, visible only via `docker logs <container>` one at a time. This makes incident investigation across the ~55+ event types and 14 services slower than it needs to be.
- **Current implementation:** Verified directly in code — the situation is more specific than "Loki transport is optional and not part of the provisioned stack" (the originating brief's framing). Concretely:
  - `packages/logger/src/loki-transport.ts` is a **complete, working Winston transport** — batches log entries (default batch size 50, flush every 2s), POSTs to `<lokiUrl>/loki/api/v1/push` in Loki's native JSON push format, and non-destructively re-queues entries on delivery failure (network error or non-2xx response). This is production-quality code, not a stub.
  - `packages/logger/src/index.ts`'s `createLogger(options: ExtendedLoggerOptions)` accepts an optional `lokiUrl` field and, if present (and `NODE_ENV !== 'test'`), adds the `LokiTransport` alongside the existing `Console` transport with labels `{ service: serviceName, env: NODE_ENV }`.
  - `createLogger` also already supports `correlationId` (added to `defaultMeta` when passed), and `packages/logger/src/correlation.ts` exports `createCorrelationIdHook`/`generateCorrelationId`/`CORRELATION_ID_HEADER` — the correlation-ID plumbing needed to make cross-service log search useful already exists.
  - **The gap, verified by grep across every `apps/*/src/main.ts`:** not a single call site anywhere in the codebase passes `lokiUrl` into `createLogger(...)`. Every service calls `createLogger({ serviceName: '<service>' })` (or with `level`) and nothing else. **The Loki transport code is fully built and never instantiated anywhere in this repository, regardless of environment.**
  - Compounding this: `infrastructure/k8s/*.yaml` (all 14 service manifests, verified in `auth-service.yaml` and `scheduler-service.yaml`) already set `LOKI_URL: "http://loki.erp-infra.svc.cluster.local:3100"` as a pod env var — meaning **the Kubernetes manifests already assume Loki exists and is being read**, but (a) no `main.ts` anywhere reads `process.env['LOKI_URL']` to pass it into `createLogger`, and (b) no Loki server is deployed anywhere — not in `docker-compose.yml` (verified — no `loki` service exists), and not in `infrastructure/k8s/` (no `loki.yaml` manifest exists). The env var points at a hostname (`loki.erp-infra.svc.cluster.local`) that would not resolve in any environment as configured today.
- **Current architecture:** Structured JSON logs (Winston, `winston.format.json()`, `errors({ stack: true })`, `timestamp()`) go to `Console` only in every service today. OpenTelemetry traces go to Jaeger (`jaeger` docker-compose service, OTLP on 4317/4318) — fully wired, 13/14 services. Prometheus metrics go to Prometheus/Grafana — fully wired. Logs are the one observability pillar with a built transport and zero actual delivery path.
- **Current limitations:** (1) `LokiTransport` is dead code — implemented, exported, never called with a URL anywhere; (2) no Loki server exists in either the local dev stack or the (non-existent, per PG-022) Kubernetes deployment; (3) k8s manifests set an env var pointing at a Loki hostname that doesn't exist yet, creating a misleading impression that this is wired when it isn't; (4) no Grafana datasource for Loki is provisioned (`infrastructure/docker/grafana/provisioning/datasources/` currently has only `prometheus.yaml` — verified via `Glob`), so even once logs reach Loki, Grafana Explore wouldn't show them without an added datasource.

## Existing Code Analysis

- **What already exists and should be reused:** `LokiTransport` class in full (`packages/logger/src/loki-transport.ts`) — do not rewrite; it already handles batching, retry-via-requeue, and the correct Loki push API shape. `createLogger`'s existing `lokiUrl`/`correlationId` options — the wiring point this package needs is simply *passing* `process.env['LOKI_URL']` into every service's existing `createLogger({...})` call, not adding new options to the function signature. `createCorrelationIdHook`/`CORRELATION_ID_HEADER` (`packages/logger/src/correlation.ts`) — reuse as the label/field that makes Loki search-by-request-across-services actually useful; verify (read the file) whether the correlation ID is already threaded from the Fastify request hook into the per-request logger's `defaultMeta`, or whether that wiring itself has a gap worth closing in the same pass.
- **What should never be modified:** The existing `Console` transport and its behavior (silenced only in `NODE_ENV === 'test'`) — Loki is additive, not a replacement for local/stdout visibility during development.
- **Prior related work:** None found under `ERP-PLANNING/phase-completions/` specifically about Loki — this appears to be the first package to close this particular loop. The k8s manifests' premature `LOKI_URL` references (see above) suggest whoever authored `infrastructure/k8s/` intended this to already be wired, or intended it as a forward-looking placeholder — either way, no completion report claims it is done, and the code confirms it is not.

## Architecture

- Add **Loki** + **Promtail** (or rely on the already-built `LokiTransport` push-based approach instead of Promtail's pull-from-file-then-push model — since every service already pushes structured JSON directly via `LokiTransport`, a Promtail scrape-the-container-logs sidecar would be redundant; recommend **Loki only**, receiving direct pushes from each service's already-built transport, not Loki+Promtail, since Promtail's usual job — tailing container log files and pushing to Loki — is already done by `LokiTransport` at the application layer). This simplifies the deployment (one new container, not two) and is a better fit for this codebase's existing pattern (structured, labeled logs pushed directly from the app, same philosophy as how metrics are pushed/scraped and traces are OTLP-exported).
- `docker-compose.yml`: new `loki` service (`grafana/loki:<version matching the existing Grafana 11.4.0 / Prometheus v3.1.0 recency>`), exposing `3100`, with a minimal `infrastructure/docker/loki/loki-config.yaml` (filesystem storage for local dev, matching the simplicity of this stack's existing Prometheus/Grafana config approach — no need for object-storage-backed Loki in local dev).
- Wire every service's `main.ts` bootstrap: `createLogger({ serviceName: '<service>', lokiUrl: process.env['LOKI_URL'] })` — a one-line addition per service (14 files), reusing the option that already exists in `createLogger`'s signature. In docker-compose, set `LOKI_URL=http://loki:3100` for each service (new env var in `docker-compose.yml`, or via each service's existing `.env`-driven config).
- Grafana: add `infrastructure/docker/grafana/provisioning/datasources/loki.yaml` (alongside the existing `prometheus.yaml`) so Loki appears in Grafana Explore immediately, no manual datasource setup.
- Labels: `LokiTransport` already sets `{ service, env }` as stream labels — extend to include `correlationId` **as a queryable field in the log line, not as a Loki label** (Loki labels should stay low-cardinality — `service`/`env`/`level` are fine; `correlationId` is high-cardinality per-request data and belongs in the log line body, queryable via LogQL's `| json` / `|~` filters, not as an indexed label, to avoid Loki's well-known high-cardinality-label performance problem). This is an important correction to a naive "just add correlationId as a label" approach.
- Kubernetes (coordinate with PG-022): add `infrastructure/k8s/loki.yaml` (Deployment/Service/PVC in `erp-infra` namespace, matching the `LOKI_URL` hostname the 14 service manifests already assume — `loki.erp-infra.svc.cluster.local:3100`) so the already-written env var references finally resolve to something real.

## Database Changes

Not applicable — no schema change. Loki has its own storage backend (filesystem for dev, object storage for production), not Postgres.

## Backend

- 14 one-line changes: each `apps/*/src/main.ts`'s `createLogger({ serviceName: '...' })` call gains `lokiUrl: process.env['LOKI_URL']` (passing `undefined` in any environment where the var isn't set — `createLogger` already handles the `if (lokiUrl && ...)` guard correctly, so this is a safe, backward-compatible addition that does nothing where `LOKI_URL` is unset).
- Verify (and, if missing, wire) that the per-request correlation ID from `createCorrelationIdHook` actually reaches the logger's per-request `child()` bindings — read `packages/logger/src/correlation.ts` and each service's Fastify bootstrap to confirm `fastify.log`/the service's logger instance is actually enriched with the request's correlation ID on each request, not just generated and returned as a response header. If this wiring is already correct, this package only needs to confirm it, not build it; if it's missing, closing it is squarely in this package's scope since it's the specific thing that makes Loki cross-service search valuable (the stated business objective).
- No new Prometheus metrics or Kafka events — this is a logging-transport wiring change only.

## Frontend

Not applicable — backend/infra-only gap. (Grafana Explore is the intended log-search UI, not a custom in-app log viewer.)

## API Contract

Not applicable — no new REST endpoints. Loki exposes its own query API (`/loki/api/v1/query_range` etc.), consumed by Grafana, not by this app's own frontend.

## Multi-Tenant Considerations

- Log lines already carry `tenantId` in `defaultMeta` when `createLogger` is called with a `tenantId` option (per `LoggerOptions.tenantId` in `packages/logger/src/index.ts`) — verify this is actually populated per-request in multi-tenant contexts (likely via a per-request `logger.child({ tenantId })` call in each service's tenant-resolution middleware) so Loki queries can filter by tenant for support/debugging without exposing one tenant's logs to another engineer investigating a different tenant's issue (an operational-access-control concern, not a Loki-technical one — flag as a process/access-control note: whoever has Grafana Explore access can see all tenants' logs commingled by default; if this matters for compliance, a follow-up would restrict via Grafana's own row-level query restrictions or separate Loki tenants via Loki's multi-tenancy mode — note as an optional future hardening, not required for this package's core deliverable).

## Integration

- **All 14 backend services** — one-line `main.ts` change each to pass `lokiUrl` through.
- **docker-compose.yml / infrastructure/k8s** — new Loki deployment.
- **Grafana** — new datasource provisioning file, enabling Explore correlation alongside the already-wired Prometheus/Jaeger datasources.
- **PG-022 (Kubernetes)** — the k8s manifests already reference `LOKI_URL` pointing at a hostname this package's `infrastructure/k8s/loki.yaml` needs to actually stand up; coordinate so PG-022's Helm chart templating includes this package's Loki manifest rather than each package writing a divergent one.

## Coding Standards

- Reuse `createLogger`'s existing `ExtendedLoggerOptions` interface as-is — no new logger-construction pattern introduced. `@erp/logger` remains the single logging package; no service should reach for a different logging library or a raw `fetch`-to-Loki call outside this already-built transport.
- Loki/Grafana config files follow the existing `infrastructure/docker/<component>/` directory convention (matching `infrastructure/docker/prometheus/`, `infrastructure/docker/grafana/`).

## Performance

- `LokiTransport`'s existing batching (50 entries or 2s, whichever first) already bounds request volume to Loki reasonably — no change needed there.
- Loki label cardinality must stay low (`service`, `env`, `level` — not `correlationId`, `tenantId`, or `userId` as labels) per Loki's own documented best practice — high-cardinality labels cause severe query performance degradation and excessive index growth. This is called out explicitly in Architecture above because it's an easy mistake to make when the natural instinct is "add correlationId as a label for easy filtering."

## Security

- Loki's HTTP push endpoint (`3100`) should not be publicly exposed without auth in production (same posture as Prometheus/Grafana/Alertmanager) — local dev docker-compose exposing it on a host port is fine; production/Kubernetes should keep it cluster-internal only (matches the existing `loki.erp-infra.svc.cluster.local` hostname pattern already assumed by the k8s manifests, which implies cluster-internal-only was the original intent).
- Log content itself may contain PII (customer names, phone numbers) depending on what each service logs today — this package does not audit every log statement for PII leakage (out of scope, a much larger cross-cutting concern), but should note it as a known risk once centralized log search makes such data easier to find/export in bulk than when it was scattered per-container.

## Testing

- No unit test applies to the Loki server itself; validate via a manual/documented check: start `docker compose up loki grafana <a couple of services>`, hit an endpoint that logs, and confirm the log line appears in Grafana Explore's Loki datasource within the transport's flush interval (~2s).
- Add a small unit test for the `main.ts` wiring change if any service has an existing bootstrap test that asserts `createLogger` call arguments (check `apps/*/src/__tests__/` for such a test; if none exists, this is a low-value test to add net-new purely for a one-line options change — prioritize the manual end-to-end check over inventing a new unit test for this).
- `LokiTransport` itself already appears to have no dedicated unit test (verify via `packages/logger`'s test directory) — if genuinely untested, add a test mocking `fetch` to confirm batching/requeue-on-failure behavior, since this transport has been sitting unexercised in any environment.

## Acceptance Criteria

- [ ] `docker compose up loki` brings up a working Loki instance reachable at `:3100`.
- [ ] All 14 services' `main.ts` pass `lokiUrl: process.env['LOKI_URL']` into `createLogger`, verified by grep (zero remaining `createLogger({ serviceName: ... })` calls missing the option where `LOKI_URL` is expected to be set).
- [ ] With `LOKI_URL` set, a log line emitted by any service is queryable in Grafana Explore's Loki datasource within ~2-5 seconds.
- [ ] Grafana has a provisioned Loki datasource (`infrastructure/docker/grafana/provisioning/datasources/loki.yaml`), visible without manual UI setup.
- [ ] Log lines are filterable/searchable by `correlationId` (as a log-line field, not a Loki label) and cross-referenced against the matching Jaeger trace for the same request (both should share the same correlation/trace identifier if that wiring is confirmed correct).
- [ ] `infrastructure/k8s/loki.yaml` exists and resolves the hostname the 14 service manifests already reference (`loki.erp-infra.svc.cluster.local`), coordinated with PG-022.

## Deliverables

- **Files to create:** `infrastructure/docker/loki/loki-config.yaml`, `infrastructure/docker/grafana/provisioning/datasources/loki.yaml`, `infrastructure/k8s/loki.yaml`.
- **Files to modify:** `docker-compose.yml` (new `loki` service + `LOKI_URL` env var for each existing service), all 14 `apps/*/src/main.ts` (pass `lokiUrl` into `createLogger`), possibly `packages/logger/src/correlation.ts`/each service's Fastify bootstrap if correlation-ID-to-logger wiring is found incomplete during verification.
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** a `LokiTransport` unit test (batching/requeue-on-failure via mocked `fetch`) if none currently exists; a documented manual end-to-end log-search verification step.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `packages/logger/src/loki-transport.ts` is a complete, correct Winston transport for pushing structured logs to Loki, and `createLogger` (`packages/logger/src/index.ts`) already accepts a `lokiUrl` option that wires it in. Despite this, **zero call sites anywhere in `apps/*/src/main.ts` pass `lokiUrl`** — verified by grep across the entire `apps/` tree. Compounding the disconnect, every service's Kubernetes manifest (`infrastructure/k8s/*.yaml`) already sets a `LOKI_URL` env var pointing at `http://loki.erp-infra.svc.cluster.local:3100` — a hostname that resolves to nothing, since no Loki server is deployed anywhere in this repo (not in `docker-compose.yml`, not in `infrastructure/k8s/`). This is best understood as: the log-shipping client is fully built and the infra manifests assume it's wired, but the actual connection was never made and the server-side doesn't exist yet.

**Current Objective:** Deploy a Loki server (docker-compose first, then a matching `infrastructure/k8s/loki.yaml` coordinated with PG-022), make the one-line `lokiUrl` wiring change in all 14 services' bootstrap code, provision a Grafana Loki datasource, and confirm correlation-ID-based cross-service log search actually works end-to-end.

**Architecture Snapshot:**
1. Loki-only (no Promtail) is the right shape here — every service already pushes structured logs directly via `LokiTransport`; a log-file-tailing sidecar would be redundant, not complementary.
2. `correlationId` must be a log-line field, not a Loki label — Loki label cardinality must stay low (`service`/`env`/`level` only).
3. The k8s manifests' existing `LOKI_URL` references are aspirational, not evidence of prior Loki work — don't assume they mean Loki is deployed; they're the reason to build `infrastructure/k8s/loki.yaml` matching that exact hostname.
4. `createCorrelationIdHook`/`CORRELATION_ID_HEADER` already exist in `packages/logger/src/correlation.ts` — verify whether they're actually threaded into each service's per-request logger before assuming cross-service search will be useful out of the box.

**Completed Components:** `LokiTransport`, `createLogger`'s `lokiUrl` option, correlation-ID generation/header utilities — all reusable as-is, none need rewriting.

**Pending Components:** The Loki server itself (both environments), the 14 `main.ts` wiring lines, the Grafana datasource, verification (and possible fix) of correlation-ID-to-logger threading.

**Known Constraints:** No live Docker/cluster environment guaranteed in every session — validate config files statically where a live environment isn't available, and flag the manual end-to-end log-search check as pending if it couldn't actually be run.

**Coding Standards:** Reuse `ExtendedLoggerOptions` as-is; no new logging library or pattern introduced.

**Reusable Components:** `LokiTransport`, `createLogger`, `createCorrelationIdHook`, `CORRELATION_ID_HEADER`, `generateCorrelationId` — all in `packages/logger`.

**APIs Already Available:** Loki's own push/query API (`/loki/api/v1/push`, `/loki/api/v1/query_range`) — consumed by the existing transport and by Grafana respectively, not new endpoints this package builds.

**Events Already Available:** Not applicable.

**Shared Utilities:** `@erp/logger` (the entire package this work touches).

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Log lines should carry `tenantId` where available (verify this is populated per-request); note (don't necessarily solve) the operational-access-control implication of centralizing all tenants' logs into one queryable store.

**Security Rules:** Loki's push endpoint must not be publicly exposed without auth in production; note (don't audit exhaustively) that centralized log search makes any pre-existing PII-in-logs issue easier to find in bulk.

**Database State:** Not applicable.

**Testing Status:** `LokiTransport` appears to have no dedicated unit test today — verify and add one (mocked `fetch`, batching/requeue behavior) if genuinely absent.

**Next Session Plan:** Single session is realistic — the code-side change is a one-line addition repeated 14 times plus new, small config files; no complex logic to build since the hard part (the transport itself) is already done.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/003-Infrastructure/19-centralized-log-aggregation-loki.md` and implement PG-025: deploy Loki (docker-compose + a new `infrastructure/k8s/loki.yaml` matching the hostname already referenced in every service's k8s manifest), wire `lokiUrl: process.env['LOKI_URL']` into all 14 services' `createLogger(...)` calls in their `main.ts` files (currently missing everywhere, verified by grep), add a Grafana Loki datasource, and confirm correlation-ID-based log search works end-to-end. Re-verify the current state of `packages/logger/src/` and each service's `main.ts` first."
