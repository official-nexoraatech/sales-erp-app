-- Backfill for existing tenants: role-defaults.ts's wildcard/explicit grants only apply at
-- NEW tenant-provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (see migrations 0097,
-- 0106, 0108, 0109, 0111, 0113 for the same recurring pattern).
-- CRM-ROADMAP Phase 1, Feature 7 grants CRM_ACCOUNT_IMPORT/LEAD_IMPORT to OWNER/ADMIN/
-- SUPER_ADMIN (via TENANT_SCOPED_PERMISSIONS) and to SALES_MANAGER (explicit grant, same role
-- that already owns CRM_ACCOUNT_*/LEAD_* CRUD and the generic IMPORT_EXECUTE).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('CRM_ACCOUNT_IMPORT'), ('LEAD_IMPORT')) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
