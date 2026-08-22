# 10 — Entitlement Impact

## 1. Fits the existing three-way model unchanged

Per `06-entitlement-model.md` and `21-capability-resolution-architecture.md` §2's Effective Capability formula — no new mechanism needed:

```
Effective Capability Set(tenant) =
    Business Profile default capabilities        [N/A yet — no business_types table]
      ∩
    plan_entitlements.feature_flags               [not yet including 'inventory.batch.enabled' —
                                                     see §2 below]
      ⊕
    feature_flags WHERE tenant_id = X              [none set — every tenant currently inherits
                                                     the new global default]
```

## 2. `plan_entitlements` — deliberately not modified this phase

`plan_entitlements` rows (`STARTER`/`GROWTH`/`ENTERPRISE`) are not updated to explicitly include `inventory.batch.enabled` in this phase. Because the new flag's **global default** is `true` (`06-database-impact.md` §2) and `plan_entitlements.feature_flags` only _narrows_ what `BillingService.assignPlanEntitlements` copies onto a tenant (per `06-entitlement-model.md` §3's "entitlement bounds business-type defaults" rule), leaving all three plans' rows untouched means every plan continues to resolve the capability `true` via the global fallback — no behavior change for any existing tenant on any plan. This is a deliberate, minimal-surface choice, not an oversight: **recommended follow-up, not built here** — once a real commercial reason exists to restrict this capability to `GROWTH`+/`ENTERPRISE` plans (a business decision, not an engineering one, per `06-entitlement-model.md` §3's own framing), a plan-design-time data change to `plan_entitlements.feature_flags` is all that's needed, zero code change.

## 3. No numeric entitlement impact

This capability has no seat/branch/quantity dimension — purely boolean, fits the existing `feature_flags`-backed slice of the entitlement model, not the separate numeric (`maxUsers`/`maxBranches`) mechanism. Confirms `06-entitlement-model.md` §2's three-way distinction holds without extension.

## 4. What this phase does not do

- Does not implement `PaymentGatewayAdapter`, billing-cycle jobs, or any PG-027 Session 2-3 work (out of scope per every governing document).
- Does not add a fourth entitlement table (`04-domain-model.md` §4 of the parent architecture already ruled this out; this phase doesn't reopen it).
