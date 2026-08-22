# 07 — Entitlement Integration

## 1. Current reality, verified this session (not assumed)

- `BillingService.assignPlanEntitlements(tenantId, plan)` (`apps/tenant-service/src/domain/BillingService.ts`) is the **only** writer of entitlement-derived `feature_flags` rows — copies `plan_entitlements.feature_flags` onto the tenant at provisioning.
- **Exactly one call site**: `TenantProvisioner.ts:242`, inside the 9-step provisioning flow. No other production code calls it.
- **No admin route exists to change a tenant's plan post-provisioning** — confirmed by reading every route in `apps/tenant-service/src/api/tenant.routes.ts`; only tenant-creation routes exist, no `PATCH .../plan`.
- **Propagation is synchronous DB-write only** — confirmed zero `publish()`/`PlatformEventBus` calls in `BillingService.ts` or its caller. No event is emitted when entitlements are assigned.

## 2. What this means for Phase 1's scope

**There is currently no code path that changes a live tenant's plan/entitlement.** This descopes a problem the original architecture docs implicitly worried about ("how does a capability get revoked when a tenant downgrades") — that scenario cannot happen today because nothing triggers it. Phase 1 therefore does **not** build:

- Any new entitlement-change propagation mechanism.
- Any new cache-invalidation trigger tied to plan changes.
- Any new event type for entitlement changes.

Building any of these now would be speculative — there's no real trigger to test against, and doing so would violate the "two proven consumers" / "don't generalize prematurely" discipline.

## 3. What Phase 1 does document (not build) — the single-owner rule

Restating and locking in `21-capability-resolution-architecture.md` §2's rule, now grounded in the verified evidence above: **`BillingService` remains the sole writer of entitlement-derived `feature_flags` rows.** When a future phase _does_ build a plan-change route, it must call `BillingService.assignPlanEntitlements` (or a method on the same class), never write `feature_flags` rows directly from a route handler, an admin script, or any other service. This phase adds a code comment to `BillingService.ts`'s class docblock stating this rule explicitly (see `17-file-level-change-plan.md`) — a small, safe, non-behavioral documentation change that locks in the architectural decision for future sessions without touching any logic.

## 4. Existing propagation path that already works, and is sufficient for Phase 1

`PlatformFeatureFlags.invalidate()` + Redis pub/sub (`01-current-code-evidence.md` §3) already correctly propagates an **ops-driven** flag toggle (via `auth-service`'s existing `PUT /admin/feature-flags/:name` route) across every process within the existing TTL bound. Since capability resolution is built entirely on `isEnabled()`, it inherits this working propagation path for free — no new code needed for "how does a capability's enabled-state change reach a running service."

## 5. What a future phase (entitlement-driven plan changes) will need to design — flagged, not built

When a `PATCH /admin/tenants/:id/plan` route is eventually built (referenced but out of scope in `multi-industry-platform/06-entitlement-model.md`/PG-027 Session 3), it should call `BillingService.assignPlanEntitlements` and that method should call `PlatformFeatureFlags.invalidate()` for every flag key whose value it just changed — otherwise a plan downgrade would silently not take effect until the existing 30s/300s TTLs expire, which may be acceptable but should be an explicit decision made when that route is actually built, not assumed now.
