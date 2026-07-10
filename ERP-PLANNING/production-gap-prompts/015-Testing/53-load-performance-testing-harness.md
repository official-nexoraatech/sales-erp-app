# [PG-055] Load/Performance Testing Harness

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Testing
**Priority:** Medium
**Complexity:** M — one new tool integration (k6), three test scripts, and wiring results back into an existing-but-disconnected performance-baseline feature.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** new top-level `load-tests/` directory, `apps/event-service` (`src/api/performance.routes.ts`), `.github/workflows/ci.yml`

---

## Overview

- **Business objective:** No load or performance test exists anywhere in this repo today (verified — see Existing Code Analysis) except for a one-off manual `k6 run` invocation used during the single chaos-engineering exercise (`ERP-PLANNING/phase-completions/chaos-engineering-report.md`, Experiment 2.2: `k6 run --vus 20 --duration 2m k6-normal-load.js`) — that script (`k6-normal-load.js`) is **not checked into the repo** (confirmed via `Glob`/grep across the whole tree); it was written and run ad hoc for that one experiment and discarded or never committed. Without a repeatable harness, there is no way to know whether a change to the invoice-confirm saga, the outbox relay, or the POS checkout path regresses latency or throughput before it reaches production — the only latency numbers anywhere in the codebase are the four hardcoded targets in `event-service`'s Performance Baselines feature, and nothing currently measures against them automatically.
- **Current implementation:** `apps/event-service/src/api/performance.routes.ts` defines a `TARGETS` constant (lines 10-16) with four hardcoded P95 latency targets: `POST /api/v2/invoices/confirm` → 500ms, `GET /api/v2/dashboard/kpis` → 200ms, `GET /api/v2/items/by-barcode` → 50ms, `GET /api/v2/customers/search` → 200ms. Three routes exist: `GET /admin/performance/baselines` (lists latest measurement per endpoint from the `performance_profiles` table), `GET /admin/performance/targets` (returns the hardcoded `TARGETS` map as-is), and `POST /admin/performance/samples` (accepts `{ endpoint, method, durationMs }` and inserts one row into `performance_profiles`). All three routes are gated by `requirePermission(PERMISSIONS.AUDIT_LOG_VIEW)` — the same over-broad permission gating already flagged as a cross-cutting issue in `[[event_service_permission_mismatch]]` for this service's DLQ/saga routes; this package does not attempt to fix that permission grain (out of scope — that belongs to PG-015).
- **Current architecture:** The `POST /admin/performance/samples` endpoint is a passive sink — nothing in the codebase currently calls it. No service has request-timing middleware that reports to it; no scheduled job aggregates real traffic into it; no load-test tool produces the samples it's designed to store. The admin console UI presumably reads `GET /admin/performance/baselines` to render a dashboard, but that dashboard is empty in practice — the "targets" are set, the "measured" side has never been populated with real data outside the one manual chaos-test run (whose actual measured numbers — p95 = 720ms for list endpoints, 850ms for invoice create, per the chaos report — were never written back into `performance_profiles`, only reported in the chaos markdown itself).
- **Current limitations:** No load-test tool config exists anywhere in the repo (verified: `grep -ril "k6\|artillery\|locust\|jmeter"` across the whole tree, excluding `node_modules`/`.git`, returns zero matches). The four hardcoded targets in `TARGETS` were never derived from a measured baseline — they read as reasonable engineering guesses (500ms for a write-heavy confirm endpoint, 50ms for a barcode lookup), not numbers backed by an actual measured P95 under realistic load. There is no CI gate that fails a build when a change regresses latency.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `performance_profiles` table + the three existing routes in `performance.routes.ts` — this package's job is to make these routes *meaningful* (fed by real k6 runs) rather than to build a new results store. Do not create a second table or a second results API.
  - The chaos report's one-off `k6-normal-load.js` invocation (`k6 run --vus 20 --duration 2m`) — even though the script itself isn't checked in, its invocation shape (20 virtual users, 2-minute duration, targeting list + invoice-create endpoints) is a reasonable starting point for the "normal load" scenario's parameters; recreate it as a committed script rather than reinventing parameters from scratch.
  - `registerHealthRoute` (`@erp/sdk`) — every service's `/health` endpoint is a natural k6 smoke/warm-up check before a real scenario run.
  - The `test` CI job's real Postgres/Redis service-container pattern in `ci.yml` (lines 78-104) — the load-test CI job (if wired into CI at all — see Architecture) should reuse this same container setup rather than a separate one.
- **What should never be modified:** The `performance_profiles` schema and the three existing routes' request/response shapes — this package is a producer that calls `POST /admin/performance/samples` (or a small batch variant, see Backend), not a consumer that changes the read-side contract other code may already depend on.
- **Prior related work:** `ERP-PLANNING/phase-completions/chaos-engineering-report.md` Experiment 2.2 is the only prior load-test activity in this project's history — read it before writing new scenarios, since its measured numbers (p95 720ms/850ms under 500ms-injected DB latency) are a useful sanity check for what "normal" looks like without a fault injected. `[[event_service_permission_mismatch]]` documents the permission-gating issue on these same routes — noted but explicitly out of scope here.

## Architecture

- Adopt **k6** (not Artillery/Locust/JMeter) — it fits this stack directly: scripts are JS/TS (matches the rest of the monorepo's language), it has first-class Prometheus/Grafana output (this repo already runs `infrastructure/docker/prometheus` and `infrastructure/docker/grafana`, per the Existing Code Analysis of adjacent packages), and it was already the tool reached for once, ad hoc, in the chaos exercise — continuing with it avoids introducing a second load-testing paradigm for no reason.
- New top-level `load-tests/` directory (sibling to `apps/`, `packages/`, `infrastructure/` — a cross-cutting tool, not owned by one service):
  - `load-tests/scenarios/pos-checkout.js` — highest-risk flow per business impact: simulates concurrent POS quick-sale checkouts (`sales-service` invoice-create + `inventory-service` stock deduction), the same path this repo's offline-first work (`[[offline02_completion_2026_07_05]]`) already hardened for idempotency; load-testing it verifies that hardening holds under concurrency, not just correctness.
  - `load-tests/scenarios/invoice-confirm-stock-deduction.js` — targets `POST /api/v2/invoices/confirm` directly (the one endpoint with an explicit hardcoded target, 500ms P95) under concurrent load against overlapping stock/warehouse rows, to surface any lock contention in the stock-deduction path.
  - `load-tests/scenarios/outbox-relay-throughput.js` — floods invoice/GRN/payment creation to generate outbox events, then measures relay lag (time from `outbox_events.created_at` to `published_at`) under sustained producer load — this is the one scenario that isn't a pure HTTP-latency test; it needs a small custom k6 check that polls a relay-lag metric or queries the outbox table directly (k6 supports raw SQL via an extension, or a thin companion Node script can expose relay lag as a JSON endpoint for k6 to poll — pick whichever is less code; a companion script is likely simpler than adding a k6 SQL extension for one metric).
  - `load-tests/k6-config.js` — shared config (base URLs per environment, VU/duration presets for "smoke" vs "normal load" vs "stress" profiles) so the three scenario scripts don't each hardcode connection details.
- Results feed back into `event-service`'s existing sink: each scenario's k6 run, on completion, POSTs its measured p50/p95/p99 per endpoint to `POST /admin/performance/samples` (reuse as-is; if per-run aggregate posting is awkward with the existing single-sample shape, add a thin batch variant, e.g. `POST /admin/performance/samples/batch` accepting an array — a small additive change, not a breaking one) — this is what finally makes the "Performance Baselines" admin console show real, measured numbers instead of an empty dashboard.
- Once at least one real k6 run's numbers exist for all four `TARGETS` endpoints, replace the hardcoded guesses in `TARGETS` with the measured baseline (e.g. if POS checkout's real P95 for `POST /api/v2/invoices/confirm` measures at 380ms under normal load, that becomes the new target, not the original 500ms guess) — this is the concrete deliverable that closes the loop the inventory flagged ("hardcoded P95 targets ... implies target numbers already exist somewhere even if no harness produces/validates them").

## Database Changes

Not applicable — no schema change. Reuses the existing `performance_profiles` table as-is (or with an additive batch-insert path, not a schema change).

## Backend

- `apps/event-service/src/api/performance.routes.ts`: optionally add `POST /admin/performance/samples/batch` (array-accepting variant of the existing single-sample route) if batching many k6-measured percentiles in one call proves simpler than N individual POSTs — keep the existing single-sample route unchanged either way.
- After the first real measured run, update the `TARGETS` constant (lines 10-16) with measured values, and add a one-line comment noting the k6 scenario + date the number came from (so a future reader knows it's a measured baseline, not a guess) — matches this repo's existing convention of dated comments explaining "why" (see `// Target P95 latency benchmarks per endpoint (M12.7)` already there).
- No changes to `sales-service`, `inventory-service`, or any other service's application code — k6 scripts are pure external HTTP-load generators against already-existing endpoints.

## Frontend

Not applicable — backend/infra-only gap. No UI changes; the existing (if any) Performance Baselines admin console page continues to read from the same `GET /admin/performance/baselines` route, which will now return real data.

## API Contract

- `POST /admin/performance/samples` — existing, unchanged: `{ endpoint: string, method: string, durationMs: number }` → `201 { data: { recorded, endpoint, method, durationMs } }`.
- `POST /admin/performance/samples/batch` (new, optional) — `{ samples: Array<{ endpoint, method, durationMs }> }` → `201 { data: { recorded: number } }`. Only build this if single-sample POSTing per k6 run proves impractical; otherwise skip it (avoid speculative API surface per "Simplicity First").

## Multi-Tenant Considerations

- Load-test scenarios must run against a dedicated load-test tenant, never a shared dev/staging tenant with real-looking data mixed in — seed a throwaway tenant per run (or reuse one fixed load-test tenant ID that's always reset/truncated before each run) so measured latency reflects realistic data volumes without polluting other tenants' data or getting skewed by unrelated concurrent traffic.

## Integration

- **`event-service`** — receives the k6 run results via the existing (or lightly extended) `/admin/performance/samples` route.
- **`sales-service`, `inventory-service`** — targeted directly by the POS-checkout and invoice-confirm scenarios (no code changes, just load).
- **Kafka/outbox** — the relay-throughput scenario measures the existing outbox-relay pipeline's lag under load; no changes to the relay itself.
- **Prometheus/Grafana (`infrastructure/docker/prometheus`, `infrastructure/docker/grafana`)** — k6 supports a Prometheus remote-write output; wire k6 runs to push directly into the existing Prometheus stack for real-time dashboards during a run, in addition to (not instead of) posting summary percentiles to `event-service` for historical baseline tracking.

## Coding Standards

- k6 scripts are JavaScript (k6's own runtime, not Node) — keep them simple, flat scenario files matching this repo's general "no speculative abstraction" bias; a shared `k6-config.js` for connection details is the only shared module needed, don't build a k6 scenario framework for three scripts.
- Reuse `@erp/logger`-style structured log conventions is not applicable here (k6 has its own console output) — but the companion script for outbox-relay-lag polling (if built as a separate Node script rather than a k6 extension) should use `@erp/logger` like every other Node script in this repo.

## Performance

- This entire package *is* a performance-testing addition — no further caching/indexing implications beyond what the scenarios might surface as findings (e.g. if the relay-lag test reveals a real bottleneck, that becomes a *new* PG-XXX gap in this same backlog per the chaos-cadence package's feedback-loop convention, PG-056 — not silently fixed inside this package).

## Security

- Load-test scripts must never run against a production URL — hardcode a safety check (e.g. refuse to run if the target base URL matches a known production domain pattern) or gate via an explicit `LOAD_TEST_ENV=staging|local` environment variable the script checks before executing, given the real risk of accidentally DoS-ing a live tenant-facing environment.
- No new permission constants needed for the k6 scripts themselves; the `POST /admin/performance/samples` route's existing `AUDIT_LOG_VIEW` gate is reused as-is (not this package's job to fix — see PG-015).

## Testing

- This package *is* test tooling; "tests for the tests" are limited to a k6 script syntax/lint check (`k6 run --dry-run` or equivalent) added as a lightweight CI step, not a full run on every PR (real load runs are expensive and noisy for per-PR feedback) — schedule real k6 runs nightly or on-demand via a manual workflow dispatch, mirroring the "expensive tier runs less often" pattern already used for `security-scan`/`build` in `ci.yml`.
- New test/tooling files: `load-tests/scenarios/pos-checkout.js`, `load-tests/scenarios/invoice-confirm-stock-deduction.js`, `load-tests/scenarios/outbox-relay-throughput.js`, `load-tests/k6-config.js`.

## Acceptance Criteria

- [ ] `k6 run load-tests/scenarios/pos-checkout.js` completes locally against a running dev stack and produces a p50/p95/p99 summary.
- [ ] At least one scenario's results are successfully POSTed to `event-service`'s `/admin/performance/samples` (or batch variant) and visible via `GET /admin/performance/baselines`.
- [ ] The four hardcoded values in `TARGETS` (`performance.routes.ts` lines 10-16) are replaced with measured baselines from a real k6 run, with a comment noting the source scenario and date.
- [ ] A CI step (manual-dispatch or nightly, not per-PR) runs the k6 scenarios and fails the workflow if any scenario's measured P95 exceeds its stored target by a defined margin (e.g. 20%).
- [ ] A safety check prevents any scenario from executing against a production-looking base URL.

## Deliverables

- **Files to create:** `load-tests/scenarios/pos-checkout.js`, `load-tests/scenarios/invoice-confirm-stock-deduction.js`, `load-tests/scenarios/outbox-relay-throughput.js`, `load-tests/k6-config.js`, optionally `load-tests/relay-lag-poller.js` (companion script for the relay scenario).
- **Files to modify:** `apps/event-service/src/api/performance.routes.ts` (`TARGETS` updated with measured values; optional batch route), `.github/workflows/ci.yml` (new nightly/manual-dispatch `load-test` job).
- **Migrations:** none.
- **APIs added/changed:** optional `POST /admin/performance/samples/batch`.
- **Events added/changed:** none.
- **Tests added:** the three k6 scenario scripts themselves (they are the deliverable, not a separate test suite testing them).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** No load-testing tool or config exists anywhere in the repo today. `event-service` has a small "Performance Baselines" feature (`performance.routes.ts`) with four hardcoded P95 latency targets and a passive `POST /admin/performance/samples` sink that nothing currently calls — the dashboard it presumably feeds is empty of real data. The one prior load-test activity was a single ad hoc `k6 run --vus 20 --duration 2m k6-normal-load.js` invocation during the one-time chaos-engineering exercise (`chaos-engineering-report.md`, Experiment 2.2) — that script was never committed to the repo.

**Current Objective:** Build a committed, reusable k6 harness with three scenarios (POS checkout, invoice-confirm stock deduction, outbox relay throughput under load), wire their results back to `event-service`'s existing (unused) samples endpoint, and replace the four hardcoded `TARGETS` with real measured baselines.

**Architecture Snapshot:**
1. `performance_profiles` table + three routes already exist in `apps/event-service/src/api/performance.routes.ts` — reuse the schema and routes as-is; don't invent a second results store.
2. All three existing routes are gated by `requirePermission(PERMISSIONS.AUDIT_LOG_VIEW)` — a known over-broad-permission issue tracked separately as PG-015; not this package's job to fix.
3. `infrastructure/docker/prometheus` and `infrastructure/docker/grafana` already exist and run — k6's Prometheus remote-write output can feed them directly for live dashboards during a run.
4. The `test` CI job already has a working real-Postgres/real-Redis service-container pattern (`ci.yml` lines 78-104) — reuse it for any CI-run k6 job rather than building a new container setup.

**Completed Components:** The `performance_profiles` schema and its three routes — treat as given, extend additively only.

**Pending Components:** Fixing the `AUDIT_LOG_VIEW` over-broad permission grain on these routes (PG-015's job, not this package's).

**Known Constraints:** No live Docker/Postgres stack may be available in every dev session — if unavailable, build and syntax-validate the k6 scripts (`k6 run --dry-run` style check) and flag "requires a live stack run to produce real baseline numbers before `TARGETS` can be updated," don't fabricate measured numbers.

**Coding Standards:** k6 scripts in plain JS (k6's runtime); any companion Node polling script uses `@erp/logger` like the rest of the repo. No new load-testing abstraction beyond a shared `k6-config.js` for connection details.

**Reusable Components:** `POST /admin/performance/samples` (existing sink); `registerHealthRoute`'s `/health` endpoints for pre-run readiness checks; the `test` CI job's Postgres/Redis container block.

**APIs Already Available:** `GET /admin/performance/baselines`, `GET /admin/performance/targets`, `POST /admin/performance/samples` — all in `event-service`, all pre-existing.

**Events Already Available:** the existing outbox/Kafka relay pipeline (invoice/GRN/payment → outbox_events → Kafka) is the target of the relay-throughput scenario, not something this package modifies.

**Shared Utilities:** `@erp/logger` for any companion Node script; none new required for the k6 scripts themselves (k6 has its own runtime and output primitives).

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** load-test scenarios must run against a dedicated, resettable load-test tenant — never a shared dev/staging tenant with real data.

**Security Rules:** scenarios must refuse to execute against a production-looking base URL (explicit environment-gate check required before any run).

**Database State:** relies on `performance_profiles` (already migrated, no new migration needed).

**Testing Status:** zero load/performance tests exist prior to this package; the k6 scripts themselves are the first.

**Next Session Plan:** Single session is feasible for scaffolding (`k6-config.js` + one scenario, e.g. `pos-checkout.js`, + wiring results to the samples endpoint). A second session can add the remaining two scenarios and the CI nightly job + `TARGETS` update, once at least one real run's numbers exist.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/015-Testing/53-load-performance-testing-harness.md` and implement PG-055. Re-verify `apps/event-service/src/api/performance.routes.ts` still has the same `TARGETS` shape and the same passive samples-sink behavior before building on it — concurrent work may have changed it since this file was written."
