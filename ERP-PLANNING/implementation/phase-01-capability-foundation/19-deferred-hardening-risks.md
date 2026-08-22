# 19 — Deferred Hardening Risks (out of Phase 1 scope, tracked per Decision 3)

Both items below were found during the pre-implementation gate review (`18-pre-implementation-review.md` §7) via direct code inspection, not assumption. Per explicit architect decision (Decision 3, 2026-08-18), Phase 1's scope is **not** expanded to fix either — they are real, pre-existing, and independent of everything Phase 1 builds. This file exists so they aren't lost between sessions.

## Risk 1 — `BillingService.assignPlanEntitlements` is not transaction-wrapped

**File**: `apps/tenant-service/src/domain/BillingService.ts:20-64`.

**Problem**: `tenants.plan`/`settings` is updated (lines 43-51) before the per-flag `insert(featureFlags).onConflictDoUpdate(...)` loop (lines 53-61) runs. Each iteration is its own auto-committed statement — nothing groups them with the earlier tenant update. A crash or error partway through the loop leaves a tenant with its new plan recorded but only some of that plan's flags applied.

**Why not fixed in Phase 1**: Phase 1 does not call `assignPlanEntitlements` and does not add any new caller of it — the only existing call site is `TenantProvisioner.ts:242`, untouched by this phase. Fixing this is a self-contained change to `BillingService.ts` alone, unrelated to the capability-registry/guard work.

**Recommended fix, when picked up**: wrap lines 43-61 in `this.db.transaction(async (tx) => { ... })`, mirroring the transaction pattern already used elsewhere in the same service (`apps/tenant-service/src/api/branch.routes.ts:160`).

**Reachability today**: only exercised at tenant provisioning (the sole call site) — low real-world frequency, but a genuine correctness gap if it fires.

## Risk 2 — `PlatformFeatureFlags` write-after-invalidate cache race

**File**: `packages/platform-sdk/src/feature-flags.ts` — `getValue()` (lines 47-68), `invalidate()` (107-117).

**Problem**: the DB write (by a caller, e.g. `auth-service`'s `PUT /admin/feature-flags/:name`), the L2 Redis delete, and the pub/sub invalidation broadcast are three separate, un-atomic network round trips. Two concrete race windows were traced in the gate review:

- **Window A**: a read landing between the DB commit and the `cache.del()` calls serves and re-caches the stale value for another L1 TTL (30s).
- **Window B**: a slower reader's `getJson`/`fetchFromDb` result can be written to L1/L2 _after_ another process's invalidate/write has already completed, re-poisoning the cache with a stale value for up to the full L2 TTL (300s/5min) — worse than the commonly-assumed 30s bound.

**Why not fixed in Phase 1**: this is pre-existing behavior in code Phase 1 reuses as-is (`isCapabilityEnabled` calls `PlatformFeatureFlags.isEnabled()` unmodified) — Phase 1 introduces no new writer to `feature_flags` and therefore doesn't create new race opportunities; it inherits whatever staleness risk already exists for every other flag-gated behavior in the app today.

**Recommended fix, when picked up**: a compare-and-set or version-stamped cache write (e.g. include a monotonic `updatedAt`/version in the cached value, discard a write whose version is older than what's already cached) would close both windows without requiring a distributed lock. Scope this as its own hardening ticket — it touches a shared primitive (`PlatformFeatureFlags`) used far beyond the capability layer, so it deserves its own review independent of Phase 1.

**Reachability today**: requires a flag to be actively toggled via the existing ops route while under concurrent read load — an operational scenario, not a routine one, but real.

## Not tracked here as a third item, but related

`18-pre-implementation-review.md` §7 also noted an unguarded interleaving between `BillingService` (during provisioning) and `auth-service`'s ops-driven flag-toggle route, both potentially writing to the same `(tenantId, flagKey)` row during a tenant's `PROVISIONING` window. This is a narrower instance of Risk 1/2 combined, not a separate mechanism — folding it into whichever of the two tickets above is picked up first is sufficient; it doesn't need its own tracking entry.
