-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122).
-- CRM-ROADMAP Phase 2, Feature 3: LOYALTY_TIER_MANAGE + LOYALTY_REDEEM to OWNER/ADMIN/
-- SUPER_ADMIN/SALES_MANAGER; LOYALTY_REDEEM only (not TIER_MANAGE) to CASHIER — this closes a
-- real gap where /pos/loyalty/redeem's guard is moving from POS_MANAGE to LOYALTY_REDEEM and
-- CASHIER never held POS_MANAGE, which would otherwise silently lock cashiers out of loyalty
-- redemption at checkout.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('LOYALTY_TIER_MANAGE'),
  ('LOYALTY_REDEEM')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'LOYALTY_REDEEM', r.tenant_id
FROM "roles" r
WHERE r.name = 'CASHIER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
