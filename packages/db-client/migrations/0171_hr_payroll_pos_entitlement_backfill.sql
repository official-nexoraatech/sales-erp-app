-- Phase 3 (HR_PAYROLL/POS capability enforcement), D1 — plan-derived entitlement backfill.
--
-- pos.enabled/hr.payroll.enabled have existed since before this phase but were never read by
-- any route-access-control code, so no tenant's flag value has ever had to be accurate. This
-- phase wires requireCapability() onto real routes, so before enforcement ships, every
-- existing tenant's flag must be brought in line with what its own plan already entitles it
-- to (plan_entitlements.feature_flags) — not a blanket true (would over-grant STARTER
-- tenants) and not usage-evidence-only (misses a real ENTERPRISE tenant with zero
-- feature_flags rows for these keys at all). Idempotent — safe to re-run.

UPDATE feature_flags ff SET enabled = true
FROM tenants t, plan_entitlements pe
WHERE ff.tenant_id = t.id
  AND pe.plan = t.plan
  AND ff.flag_key = 'pos.enabled'
  AND pe.feature_flags @> '["pos.enabled"]'::jsonb
  AND ff.enabled = false;

UPDATE feature_flags ff SET enabled = true
FROM tenants t, plan_entitlements pe
WHERE ff.tenant_id = t.id
  AND pe.plan = t.plan
  AND ff.flag_key = 'hr.payroll.enabled'
  AND pe.feature_flags @> '["hr.payroll.enabled"]'::jsonb
  AND ff.enabled = false;

INSERT INTO feature_flags (tenant_id, flag_key, enabled)
SELECT t.id, 'pos.enabled', true
FROM tenants t
JOIN plan_entitlements pe ON pe.plan = t.plan
WHERE pe.feature_flags @> '["pos.enabled"]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM feature_flags ff WHERE ff.tenant_id = t.id AND ff.flag_key = 'pos.enabled'
  );

INSERT INTO feature_flags (tenant_id, flag_key, enabled)
SELECT t.id, 'hr.payroll.enabled', true
FROM tenants t
JOIN plan_entitlements pe ON pe.plan = t.plan
WHERE pe.feature_flags @> '["hr.payroll.enabled"]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM feature_flags ff WHERE ff.tenant_id = t.id AND ff.flag_key = 'hr.payroll.enabled'
  );
