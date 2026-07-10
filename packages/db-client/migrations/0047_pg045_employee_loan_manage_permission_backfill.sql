-- PG-045: EMPLOYEE_LOAN_MANAGE is a new permission constant. role-defaults.ts's
-- TENANT_SCOPED_PERMISSIONS wildcard (OWNER/SUPER_ADMIN), ADMIN's filtered variant, and
-- HR_MANAGER's explicit list are only evaluated against whatever constants exist in
-- packages/shared-types/src/permissions.ts at tenant-provisioning time, so any tenant
-- provisioned before this change won't have it in role_permissions even though those roles
-- imply they should — same gap as 0038_pg020_sso_config_manage_permission_backfill.sql.
-- Backfill it here for existing tenants; new tenants get it for free via role-defaults.ts.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'EMPLOYEE_LOAN_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'HR_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
