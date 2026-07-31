-- Backfill for existing tenants: role-defaults.ts's wildcard/explicit grants only apply at
-- NEW tenant-provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (see migrations 0097,
-- 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0137, 0139, 0141, 0143 for the same
-- recurring pattern).
-- CRM-ROADMAP Phase 4, Feature 1 grants both FIELD_VISIT_MANAGE and ROUTE_MANAGE to OWNER/ADMIN/
-- SUPER_ADMIN (via TENANT_SCOPED_PERMISSIONS) and to SALES_MANAGER (explicit grant — this role
-- already owns the rest of the CRM/Sales-Ops domain, same reasoning as TERRITORY_MANAGE/
-- QUOTA_MANAGE).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('FIELD_VISIT_MANAGE'),
  ('ROUTE_MANAGE')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
