# PG-055 — Load/Performance Testing Harness — Completion Report

**Date:** 2026-07-11
**Status:** Partial — harness extended/fixed and wired to event-service; no real k6 run performed (no live Docker/k6 available this session).

## Summary

The gap-prompt's premise ("no load-test tool exists anywhere in this repo") was already out
of date: a concurrent session had committed a `load-tests/` directory with 5 k6 scenarios
(`k6-normal-load.js`, `k6-peak-load.js`, `k6-spike.js`, `k6-soak.js`, `k6-concurrency.js`) in
commit `7270bba`, structured differently from the three files the gap-prompt named. This
session extended that existing harness rather than duplicating it:

- **Safety check** (`assertSafeEnvironment()` in `k6-helpers.js`): every scenario's `setup()`
  now refuses to run unless `LOAD_TEST_ENV=local|staging` is explicitly set, and refuses to
  run against any URL that looks like the real company domain (`nexoraatech.com`) or contains
  "prod"/"production" — unless the host also says "staging" explicitly.
- **Results wired to event-service's existing (previously unused) sink**:
  `reportSamplesToEventService()` POSTs measured P95s to `POST /admin/performance/samples`.
  Wired into `k6-normal-load.js` (3 endpoints), `k6-peak-load.js` (1), `k6-concurrency.js` (1),
  and the new `outbox-relay-throughput.js` (1) — `GET /admin/performance/baselines` will show
  real numbers once any of these actually runs against a live stack.
- **Fixed a real bug in `k6-concurrency.js`**: it raced 200 VUs on `POST /invoices` (create),
  which never touches stock — stock deduction happens in `InvoiceService.confirm()`. The test's
  own "exactly 1 success / 199 InsufficientStockError" invariant could never have failed
  regardless of whether the real locking was correct. Rewrote it to pre-create 200 DRAFT
  invoices (race-free) in `setup()`, then race all 200 VUs on `POST /invoices/:id/confirm` —
  the endpoint that actually needs the concurrency test.
- **New scenario**: `load-tests/outbox-relay-throughput.js` — floods invoice creation and
  polls event-service's existing `GET /health/outbox` (`queueDepth`) to observe relay backlog
  under sustained producer load. No companion Node poller or k6 SQL extension was needed —
  that endpoint already existed and does the job.
- **CI**: added a `workflow_dispatch` trigger with scenario/target-URL inputs; a k6
  syntax-check step (`k6 inspect`, no execution) in the existing `lint` job, safe to run on
  every push/PR; and a new `load-test` job (manual-dispatch only) that runs one scenario
  against a caller-supplied target environment and fails the workflow if any endpoint's
  measured P95 exceeds its stored target by more than 20%.

Full narrative of what was already-built-vs-broken-vs-missing, and the reasoning behind each
choice, is in `IMPLEMENTATION-NOTES.md`'s PG-055 entry.

## Deviations from the gap-prompt

1. **Reused the existing 5-scenario harness instead of building the 3 named files**
   (`pos-checkout.js`, `invoice-confirm-stock-deduction.js`, `k6-config.js`). The existing
   `k6-normal-load.js`/`k6-peak-load.js` already cover the POS-checkout-mix intent, and the
   fixed `k6-concurrency.js` now covers the invoice-confirm-stock-deduction intent under real
   concurrency — building parallel files would have duplicated coverage. `k6-helpers.js`
   already served the "shared config" role `k6-config.js` was meant to fill; extended it
   in place instead of adding a second config module.
2. **No batch samples endpoint added.** Individual `POST /admin/performance/samples` calls
   (at most 3 per scenario run) were simple enough that the optional batch variant would have
   been speculative API surface for no real benefit.
3. **The outbox-relay scenario doesn't need a companion Node script or k6 SQL extension** —
   `GET /health/outbox` already exposes `queueDepth`. Polls that directly.
4. **CI's `load-test` job does not boot the full app/infra stack inside the runner.** No
   precedent for that exists anywhere in this repo's CI; it's a materially larger, separate
   piece of infra work. The job instead targets a caller-supplied, already-reachable
   environment (dispatch inputs) — which today means it has nothing real to run against,
   since no staging cluster is actually provisioned yet.

## Acceptance Criteria

- [ ] `k6 run load-tests/k6-normal-load.js` completes locally and produces a p50/p95/p99
      summary — **not run this session** (no Docker/k6 available). Script is syntactically
      complete and structurally ready.
- [ ] At least one scenario's results POSTed to `/admin/performance/samples` and visible via
      `/admin/performance/baselines` — **wiring done, not exercised** (same constraint).
- [ ] `TARGETS` in `performance.routes.ts` replaced with measured baselines — **not done**;
      no real run exists yet to measure from. Left as the original guesses rather than
      fabricating numbers.
- [x] A CI step (manual-dispatch) runs k6 scenarios and fails if P95 exceeds target by >20%
      — `load-test` job added; **unverified**, no reachable target environment to test it
      against this session.
- [x] Safety check preventing execution against a production-looking base URL —
      `assertSafeEnvironment()`, wired into all 6 scenarios' `setup()`.

## Verification performed this session

- No live Docker, Postgres, or `k6` binary available (`docker ps` fails to connect to the
  daemon; `k6` not on `PATH`) — consistent with `[[es24_no_live_db_available]]` and several
  prior PG-0xx sessions. No k6 script has actually been executed.
- `.github/workflows/ci.yml` validated as well-formed YAML (`yaml.safe_load`).
- Read-through review of every changed/new `.js` file for obvious syntax issues (no linter
  configured for `load-tests/` — it's outside the pnpm workspace, k6 scripts run in k6's own
  JS runtime, not Node/TypeScript).
- **Not done:** actually running `k6 inspect` or `k6 run` against any script — no k6 binary
  available locally. The new CI `lint` step running `k6 inspect` via the `grafana/k6:latest`
  Docker image is itself unverified for the same reason.

## Files touched

- `load-tests/k6-helpers.js` — `assertSafeEnvironment()`, `reportSamplesToEventService()`,
  `BASE_EVENT`, env-overridable base URLs (`BASE_*_URL`).
- `load-tests/k6-normal-load.js`, `k6-peak-load.js`, `k6-spike.js`, `k6-soak.js` — safety-check
  wiring in `setup()`; normal-load and peak-load also wired to samples-posting.
- `load-tests/k6-concurrency.js` — endpoint-targeting fix (races `/confirm`, not create) +
  samples-posting.
- `load-tests/outbox-relay-throughput.js` — new.
- `load-tests/README.md` — safety/env docs, new scenario row, results-posting note,
  known-gaps section.
- `.github/workflows/ci.yml` — `workflow_dispatch` inputs, k6 syntax-check step in `lint`,
  new `load-test` job.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-055 entry.

## Deployment Checklist

> **⚠ These steps MUST be run manually before this package is actually load-bearing. They are NOT automatic.**

- [ ] **Run each scenario against a live local/dev stack at least once** (`docker compose up
  -d`, `pnpm turbo run dev`, then `k6 run -e LOAD_TEST_ENV=local
  load-tests/k6-normal-load.js`) to confirm the scripts actually work end-to-end and to
      produce the first real measured numbers. Not done this session — no live stack
      available.
- [ ] **Update `TARGETS` in `apps/event-service/src/api/performance.routes.ts`** with the
      measured P95s from that run, with a dated comment citing the source scenario — only
      once real numbers exist.
- [ ] **Provision a real staging environment** (or point the `load-test` CI job at a tunneled
      local stack) before the `workflow_dispatch` job can do anything meaningful — it
      currently has no reachable target.
- [ ] No new environment variables required for local runs (all `BASE_*_URL` inputs default
      to `localhost`); the CI job's dispatch inputs are optional-with-required-check, not new
      persistent env vars.
- [ ] No new permissions — reuses `PERMISSIONS.PERFORMANCE_VIEW` on the existing samples
      route, unchanged.
