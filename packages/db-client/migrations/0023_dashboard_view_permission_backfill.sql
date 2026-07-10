-- Backfill DASHBOARD_VIEW for existing full-permission system roles.
--
-- Root cause: report-service's dashboard routes and the frontend route guards checked
-- 'DASHBOARD_VIEW', but it was never added to packages/shared-types' PERMISSIONS object —
-- the source apps/tenant-service/src/rbac/role-defaults.ts reads via Object.values(PERMISSIONS)
-- to seed OWNER/ADMIN/SUPER_ADMIN with every permission at tenant-provisioning time. Since the
-- constant didn't exist, no role in any tenant could ever be granted it, so every user got
-- 403 Forbidden loading /dashboard regardless of role. PERMISSIONS now includes DASHBOARD_VIEW,
-- so newly provisioned tenants get it automatically; this backfills tenants that already exist.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'DASHBOARD_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
