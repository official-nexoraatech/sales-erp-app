-- PG-037: COST_CENTER_VIEW / COST_CENTER_MANAGE are new permission constants.
-- role-defaults.ts's TENANT_SCOPED_PERMISSIONS wildcard (OWNER/ADMIN/SUPER_ADMIN) and the
-- explicit ACCOUNTANT/ACCOUNTANT_SUPERVISOR lists are only evaluated against whatever
-- constants exist in packages/shared-types/src/permissions.ts at tenant-provisioning time —
-- same gap as 0038_pg020_sso_config_manage_permission_backfill.sql. Backfill for existing
-- tenants; new tenants get it for free via role-defaults.ts.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('COST_CENTER_VIEW'), ('COST_CENTER_MANAGE')) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR')
ON CONFLICT ("role_id", "permission") DO NOTHING;
