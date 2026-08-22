# 18 — Observability and Audit

## Reused, not reinvented

`erp_capability_check_denied_total` (`packages/logger/src/erp-metrics.ts`, added in Phase 1, already labelled `capability_key` + `outcome: 'disabled' | 'resolution_error'`) automatically covers all 18 new call sites — `requireCapability`'s own body increments it, no per-route wiring beyond adding the preHandler itself. No new metric needed, unlike Phase 2B, which needed one new in-handler `.inc()` call for its non-preHandler write-path gate (`item.routes.ts`) — every route in this phase's scope uses the plain preHandler form, so the metric fires automatically.

## What becomes newly observable

Before this phase, `erp_capability_check_denied_total{capability_key="HR_PAYROLL"}` and `{capability_key="POS"}` could never increment (nothing called `requireCapability` with those keys). After this phase, these two label values start reporting real denial volume for the first time — this is the primary signal D1's shadow-mode option (if chosen) would watch, and remains valuable post-launch as an ongoing "how often are tenants hitting a capability wall" indicator, same role it already plays for `INVENTORY_BATCH`.

## Logging

Unchanged shape: `request.log.warn(...)` for a clean disable, `request.log.error(...)` for a resolution failure — both already implemented in `capability-guard.ts`, fire automatically for these 18 routes with zero new code.

## Audit

**No `audit_log`/`security_audit_log` write added**, consistent with `07-api-contracts.md`'s explicit statement and the Phase 1/2B precedent (no audit on a plain permission/capability denial).

## Dashboards

Not built by this phase (no dashboard infrastructure exists in this repo for Prometheus metrics beyond the existing `/metrics` scrape endpoint, per `scheduler_observability_audit_2026_07_22` memory's finding that a prior initiative added job-history observability the same way — metric-only, no bespoke dashboard). If D1 resolves to shadow-mode, the operator watching the observation window queries `erp_capability_check_denied_total` directly (Prometheus query, not a new UI), matching how every other capability-denial signal in this codebase is currently consumed.
