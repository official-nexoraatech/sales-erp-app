-- PG-020: SSO_CONFIG_MANAGE is a new permission constant. role-defaults.ts's
-- TENANT_SCOPED_PERMISSIONS wildcard (OWNER/SUPER_ADMIN) and ADMIN's filtered variant are
-- only evaluated against whatever constants exist in packages/shared-types/src/
-- permissions.ts at tenant-provisioning time, so any tenant provisioned before this change
-- won't have it in role_permissions even though the wildcard implies they should — same gap
-- as 0036_dlq_saga_permission_granularity_backfill.sql. Backfill it here for existing
-- tenants; new tenants get it for free via role-defaults.ts.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'SSO_CONFIG_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
