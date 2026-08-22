# 10 — Entitlement Impact

## No `plan_entitlements` interaction

`BillingService.assignPlanEntitlements` copies a plan template's `feature_flags` onto a tenant at plan-assignment time. This phase does not touch `plan_entitlements`, `BillingService`, or any plan-template row. Whether `hr.payroll.enabled`/`pos.enabled` should eventually become plan-tiered (e.g., POS only on `GROWTH`+) is exactly the kind of "pure configuration, no code change" decision `06-entitlement-model.md` §3 already anticipated — out of scope here, and D1's backfill (if chosen) does not preclude it later.

## Interaction with D1's backfill

If D1 resolves toward a backfill, that backfill writes directly to `feature_flags` (the same table `assignPlanEntitlements` writes to) — **not** to `plan_entitlements`. This means a subsequent, unrelated plan change (e.g., a tenant moving from `STARTER` to `GROWTH`) that re-runs `assignPlanEntitlements` could **overwrite** the backfilled `true` value if the relevant plan template's `feature_flags` doesn't itself include `hr.payroll.enabled: true`/`pos.enabled: true`. This is a real, evidence-based interaction worth flagging (per Rule 7 — "what writes this?") even though it is not blocking: `06-entitlement-model.md` §3 already documents `assignPlanEntitlements` as "re-copies the template... never silently drift from what the current plan grants" as the _intended_ behavior — so if the plan templates themselves don't grant these flags, a plan change could silently undo this phase's backfill. **Action for implementation time**: verify `plan_entitlements` seed data for all three plans (`STARTER`/`GROWTH`/`ENTERPRISE`) includes both flags as `true` before shipping D1's backfill, or the backfill's effect is not durable against a future plan change. Not verified in this planning pass — flagged as `TO VERIFY`.

## No entitlement (seats/branches) impact

`assertUnderUserLimit`/`assertUnderBranchLimit` are unrelated numeric entitlements, untouched.
