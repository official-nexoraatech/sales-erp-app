# 16 — Testing Strategy

Follows Phase 1/2B's established conventions exactly: mocked unit/route-level tests for the outcome matrix, real-Postgres/Redis integration tests for anything touching actual resolution or migration data, `describe.skipIf(!DATABASE_URL)` gating for the latter — and, per this session's own re-verification of Phase 1/2A/2B, **integration tests must actually be executed against real infra before this phase is called done**, not merely written and left skipped (the standard `38-phase-2a-final-verification.md` and `41-phase-2b-closure-review.md` both explicitly enforced).

## Phase 3A — HR_PAYROLL

**Unit / route-level (mocked `PlatformFeatureFlags`)**: extend or create `apps/hr-service/src/__tests__/payroll-guard.test.ts` (already exists — verify whether it's the right home or a new `payroll-capability.test.ts` is cleaner, per that file's existing scope) with the full outcome matrix, mirroring `capability-guard-route.test.ts`'s six cases: capability+permission both granted → 200; capability enabled, permission denied → existing `403 FORBIDDEN`; capability disabled, permission granted → `403 CAPABILITY_NOT_ENABLED`; resolution failure → `503`; unauthenticated → `401`; tenant isolation (tenant A on / tenant B off in the same run). Applied against at least one representative route from each of the six (payroll run creation is the highest-value one to cover explicitly, given its `HIGH` impact rating in `26-affected-flow-matrix.md`).

**Real-DB integration**: a new `apps/hr-service/src/__tests__/payroll-capability-integration.test.ts` (`describe.skipIf(!DB_URL)`), seeding a real tenant with `hr.payroll.enabled = false`/`true` and asserting the actual route (not a mock) responds correctly — mirrors `packages/platform-sdk/test/integration/inventory-batch-tenant-isolation-and-disable.integration.test.ts`'s shape.

**Regression**: full `apps/hr-service` suite re-run before/after — must show zero new failures beyond the pre-existing, already-documented `JWT_ISSUER`-mismatch class (`preexisting_jwt_issuer_test_bug` memory).

## Phase 3B — POS

**Unit / route-level**: extend `apps/sales-service/src/__tests__/pos-branch-isolation.test.ts` or a new `pos-capability.test.ts` with the same six-case matrix, applied to at least `POST /pos/sales` (the highest-`HIGH`-impact route) and one Z-report route.

**Real-DB integration**: a new `apps/sales-service/src/__tests__/pos-capability-integration.test.ts` (`describe.skipIf(!DB_URL)`), same shape as HR_PAYROLL's.

**Regression**: full `apps/sales-service` suite — this file set is large (75 test files per `36-implementation-report.md` §5's own count) and already has a known pre-existing `JWT_ISSUER` failure class covering ~12 files; re-run and diff against that known baseline, don't treat every failure as new without checking.

**Critical regression case, specific to this phase**: `pos-completion.test.ts`, `pos-sessions-active.integration.test.ts`, `offline02-pos-sale-idempotency.test.ts` all exercise the exact routes this phase gates — these must be re-run with a **capability-enabled** test tenant (their existing fixtures likely predate this phase and may not set `pos.enabled = true` at all, since nothing needed it to be `true` before). **Verify each of these files' test-tenant setup includes `pos.enabled: true` before this phase ships, or they will start failing for a reason unrelated to what they're actually testing** — this is the single most likely "false regression that's actually a real gap in test fixtures" this phase will surface, flagged explicitly rather than left for implementation time to discover cold.

## Migration test (only if D1 → backfill)

Idempotency test: running the backfill migration twice produces the same end state as running it once (matches `39-implementation-report.md`'s convention of verifying `0169`'s idempotency by direct re-application). Correctness test: after backfill, every tenant's flag state matches its plan's `plan_entitlements.feature_flags` exactly — a direct SQL assertion, not a unit test, run against the real dev DB before/after.

## Backward compatibility test

A dedicated test proving a capability-enabled tenant's request/response shape is byte-identical before/after this phase for all 18 routes — mirrors Phase 1's `navigation.test.ts` "leaves every existing item unaffected" pattern and Phase 2B's `2A-2`/`F` criteria.

## Not required

Performance tests (no new query pattern beyond what `INVENTORY_BATCH`'s route already proved cheap — one extra `PlatformFeatureFlags` resolution per gated request, same cost class already accepted in Phase 2B). Load tests. Any test touching `report-service`/`search-service`/`event-service` (confirmed untouched, `11`–`13`).
