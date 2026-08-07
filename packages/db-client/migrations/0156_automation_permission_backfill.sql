-- Backfill AUTOMATION_VIEW/AUTOMATION_EXECUTE for existing SALES_MANAGER and PURCHASE_MANAGER
-- roles. role-defaults.ts is only applied at tenant-provisioning time; this backfills tenants
-- that already exist. AUTOMATION_CREATE/EDIT/DELETE (workflow authoring) deliberately stays
-- OWNER/ADMIN/SUPER_ADMIN-only (already covered by TENANT_SCOPED_PERMISSIONS), same split as
-- migrations 0151 (RULE_*) and 0154 (COMMISSION_*).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, perm.name, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('AUTOMATION_VIEW'), ('AUTOMATION_EXECUTE')) AS perm(name)
WHERE r.name IN ('SALES_MANAGER', 'PURCHASE_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
