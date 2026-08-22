# 17 — Migration and Backward Compatibility

## Before Phase 3

Both capabilities exist, are fully mechanism-tested, and are wired to zero routes. Flag values are the raw provisioning defaults plus whatever ops has manually toggled (3 of 28 dev tenants have any `true` row; the plan-tier design in `plan_entitlements` has never been enforced).

## During migration (D1's backfill, if chosen)

Per `06-database-impact.md`: every existing tenant's `pos.enabled`/`hr.payroll.enabled` rows are set to match that tenant's plan's `plan_entitlements.feature_flags`. This is a pure data correction — no code deploys simultaneously required, and per `19-rollout-and-rollback.md`, the backfill should land and be verified **before** the code that enforces it, giving a clean rollback point if the backfill itself reveals an unexpected tenant-plan mismatch.

## After Phase 3

- **Existing tenants correctly entitled** (flag already matches plan pre-backfill, or corrected by it): zero visible behavior change. Every route continues to work exactly as before.
- **Existing tenants using a feature outside their plan's entitlement** (none found in this dev dataset, but not provable absent in production): see a new `403 CAPABILITY_NOT_ENABLED` where the request previously succeeded. This is a genuine behavior change, correctly flagged as such (not swept into "zero behavior change for all tenants," which would be a false backward-compatibility claim) — see `25-decision-record.md` D1's residual-risk note.
- **New tenants provisioned after this phase**: governed by D1b — either unchanged (`false` default, opt-in going forward) or updated (`true` default for `CLOTH_RETAIL`/`GROCERY`, preserving today's out-of-the-box behavior), per the user's D1b answer.
- **Existing API consumers** (any integration calling these 18 routes programmatically, not just `web-frontend`/`pos-frontend`): must handle the new `403`/`503` response shapes — both already-documented, existing shapes from Phase 1, not new to integrators of _other_ Phase-1/2B-gated routes, but new to any consumer of specifically these 18 endpoints.
- **Existing permission behavior**: fully unchanged — `permissions.ts`, `role-defaults.ts` untouched (`08-permissions-and-rbac.md`).
- **Existing JWT behavior**: fully unchanged — no file in `jwt.ts`/`auth.ts` touched.

## Rollback

**Code rollback**: remove the `requireCapability(...)` entry from each of the 18 `preHandler` arrays — a pure revert, zero data cleanup required, since the capability check has no side effect beyond the metric increment. Matches Phase 1/2B's own "trivial rollback" precedent.

**Data rollback** (only if D1's backfill already ran): reversible by re-running the inverse of the backfill query, scoped to exactly the rows the migration touched — but per `19-rollout-and-rollback.md`, rolling back the _data_ is not required merely to roll back the _code_, since a `true` flag with no enforcement is the same safe resting state Phase 1 shipped in for months. Only roll back the data if the backfill itself is later found to have been computed incorrectly (e.g., a `plan_entitlements` misread).

## What this phase explicitly does not attempt to guarantee

It does not guarantee zero behavior change for every conceivable tenant state — it guarantees zero behavior change for every tenant whose current flag state already matches (or is corrected by D1 to match) its plan's entitlement, which is the correct and honest scope, not an inflated claim. This distinction must survive into `20-acceptance-criteria.md` and `23-executive-summary.md` — do not round it up to "zero behavior change for all tenants," which `01-current-code-evidence.md`'s own evidence contradicts as a blanket claim.
