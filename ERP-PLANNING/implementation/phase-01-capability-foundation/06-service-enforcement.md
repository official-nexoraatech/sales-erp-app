# 06 — Service Enforcement Pattern

## 1. What this phase actually wires up

Nothing in production routing. This file documents the **pattern** a future phase (route wiring) will follow, and specifies the **test-only** route this phase builds to prove the pattern end-to-end.

## 2. The pattern (for future reference, not built into a real route here)

Following `01-current-code-evidence.md` §4/§5's confirmed closure-param convention:

```ts
// Example future usage inside e.g. apps/hr-service/src/api/payroll.routes.ts (NOT modified this phase)
export async function payrollRoutes(fastify: FastifyInstance, db: ErpDatabase, redis: Redis) {
  fastify.post(
    '/payroll/runs',
    {
      preHandler: [
        authenticate,
        requireCapability('HR_PAYROLL', db, redis),
        requirePermission(PERMISSIONS.PAYROLL_PROCESS),
      ],
    },
    handler
  );
}
```

Same registration-function-closure pattern every existing route already uses — no new bootstrap wiring, no new decorator, no new dependency-injection mechanism.

## 3. What this phase actually builds and tests

A minimal, throwaway Fastify app inside the test suite (mirroring `tenant-admin-authz.test.ts`'s `buildApp()` pattern, `01-current-code-evidence.md` §6) with one synthetic route, `GET /__test/capability-check`, gated by `requireCapability('HR_PAYROLL', db, redis)` alone (no permission layer, to isolate the capability guard specifically). This route exists **only inside `packages/platform-sdk`'s own test file**, never deployed, never part of any service's real API surface — see `12-testing-strategy.md` §2 for the full test list this proves.

## 4. Explicit non-goal: choosing between the two DB/cache-access patterns per service

`01-current-code-evidence.md` §4 found two real patterns in use: raw closure params (`auth-service`'s `feature-flags.routes.ts`) and `PlatformContext` (`context.ts`, which already builds a `PlatformFeatureFlags` instance as `this.features`). Different services may already have standardized on one or the other internally. **This phase's `requireCapability` signature takes `db`/`redis` as raw params** (matching the simpler, lower-common-denominator pattern) — a future phase wiring real routes must check, service-by-service, whether that service already has a `PlatformContext` available in its route-registration scope and, if so, may prefer a `PlatformContext`-based overload (`requireCapability(key, context.db, context.cache)` or similar) rather than constructing a second, parallel `TenantScopedDatabase`/`TenantScopedCache` pair. Not decided here — flagged as a per-service judgment call for the phase that actually touches `hr-service`/`sales-service` route files.

## 5. Risk if this pattern is later copy-pasted incorrectly

The most likely implementation mistake in a future phase: forgetting to order `requireCapability` before `requirePermission` (harmless functionally — both still enforce correctly regardless of order, since they're independent — but produces a less helpful error when both would fail, e.g. a user missing both would get `FORBIDDEN` first instead of the more actionable `CAPABILITY_NOT_ENABLED`). Documented here so a future coding session preserves the ordering decided in `05-platform-sdk.md` §7 deliberately, not by accident.
