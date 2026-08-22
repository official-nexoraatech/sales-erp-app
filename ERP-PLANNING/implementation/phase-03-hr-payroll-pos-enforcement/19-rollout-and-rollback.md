# 19 — Rollout and Rollback

## Sequencing, D1-dependent

**If D1 = (a), plan-derived backfill:**

```
Step 1 — Apply the backfill migration (06-database-impact.md), verify by direct SQL
         (every tenant's flag now matches its plan's plan_entitlements.feature_flags).
Step 2 — Deploy Phase 3A (HR_PAYROLL route gating) alone. Observe
         erp_capability_check_denied_total{capability_key="HR_PAYROLL"} for a short window
         (recommend: at least one full business day, to catch a daily/periodic payroll job).
Step 3 — If zero unexpected denials: deploy Phase 3B (POS route gating). Observe the same
         metric for POS for a comparable window before considering the phase closed —
         POS is used continuously, not periodically, so a shorter window than HR_PAYROLL's
         is defensible, but zero observation is not.
Step 4 — Tag the web-frontend nav node (09-navigation-and-frontend.md) — can ship alongside
         3A's backend change or slightly after; it is UX-only and carries no correctness risk
         either way.
```

**If D1 = (b), shadow mode first:**

```
Step 1 — Deploy requireCapability in log-only mode (the temporary deviation D1 flags) for
         both capabilities, no backfill yet.
Step 2 — Observe erp_capability_check_denied_total for a window long enough to cover at
         least one full payroll cycle (monthly, per PayrollEngine's period semantics) —
         a shorter window risks never observing the one route (payroll run creation) most
         likely to be periodic rather than continuous.
Step 3 — If the metric shows any real-tenant denial that would have blocked legitimate
         usage: investigate that tenant specifically (plan mismatch? provisioning gap like
         tenant 1's?) before proceeding.
Step 4 — Apply the plan-derived backfill for any tenant the observation window flagged
         (or, more conservatively, for all tenants per D1's original recommendation).
Step 5 — Remove the shadow-mode code path, ship real enforcement.
Step 6 — Tag the nav node.
```

**If D1 = (c), no real tenants exist yet:** ship Phase 3A and 3B together, no backfill, no observation window — the dev-tenant flags (2, 13) already exercise both paths correctly for testing.

## Feature-flag-gated rollout of the rollout itself

Not needed as a separate mechanism — `pos.enabled`/`hr.payroll.enabled` **are** the rollout flags. No meta-flag ("is capability enforcement itself turned on") is introduced, matching CLAUDE.md's Simplicity First and Phase 1/2B's own precedent of not building parallel infrastructure to gate a gate.

## Deployment sequencing between services

`hr-service` (3A) and `sales-service` (3B) deploy independently — no cross-service dependency (the mechanism is per-service, per Phase 1's design). 3A can ship, observe, and stabilize fully before 3B's code is even merged, consistent with the sub-phase split's purpose (`00-overview.md` §5).

## Monitoring gates before calling either sub-phase "done"

- `erp_capability_check_denied_total` shows the expected pattern (zero denials for the plan-derived-correct tenant set; only "correct" denials, if any, for tenants confirmed outside their plan's entitlement).
- Full regression suite for the touched service passes, including the three POS test files flagged in `16-testing-strategy.md` as needing fixture updates.
- No new error-rate anomaly in the gated routes' existing latency/error dashboards (if any exist — `TO VERIFY`, this session did not confirm whether `hr-service`/`sales-service` have route-level latency dashboards beyond the shared `/metrics` endpoint).

## Rollback triggers

Any of: the observation window (D1 (b)) or post-launch monitoring (D1 (a)) shows a real, unexpected tenant denial with no plan-mismatch explanation; the flagged POS test files fail for a reason traced to the new gate rather than a fixture gap; a production incident report ties a checkout/payroll failure to `CAPABILITY_NOT_ENABLED`. Rollback procedure: `17-migration-and-backward-compatibility.md`'s "Rollback" section (code revert is the fast path; data rollback only if the backfill itself is implicated).
