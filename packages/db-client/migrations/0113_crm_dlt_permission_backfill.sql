-- Backfill for existing tenants: OWNER/ADMIN/SUPER_ADMIN get every new permission
-- automatically at NEW tenant-provisioning time via role-defaults.ts's TENANT_SCOPED_PERMISSIONS
-- wildcard, but that wildcard is only evaluated once, at provisioning — existing tenants'
-- already-stored role_permissions rows don't retroactively pick up a constant added after they
-- were provisioned (see migrations 0097, 0106, 0108, 0109, 0111 for the same recurring pattern).
-- CRM-ROADMAP Phase 1, Feature 6 grants CRM_DLT_TEMPLATE_MANAGE to OWNER/ADMIN/SUPER_ADMIN only
-- (admin-only compliance config, not delegated to SALES_MANAGER).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CRM_DLT_TEMPLATE_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
