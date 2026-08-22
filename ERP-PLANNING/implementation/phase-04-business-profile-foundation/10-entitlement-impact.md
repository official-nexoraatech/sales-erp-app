# 10 — Entitlement Impact

## No change

`plan_entitlements`, `BillingService`, `assignPlanEntitlements` are all untouched. `business_types.default_capability_keys` (`04-domain-model.md`) is descriptive metadata only in this phase — it is not read by `BillingService` or any entitlement-resolution code, and does not interact with `plan_entitlements.feature_flags` (the mechanism Phase 3's D1 analysis examined in detail). A future phase that builds the provisioning-time consumer (`05-module-capability-model.md` §4's still-unbuilt generalization of `seedFeatureFlags`) would be the first to create that interaction — explicitly out of this phase's scope (`00-overview.md` §7).
