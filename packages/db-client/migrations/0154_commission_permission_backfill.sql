-- Backfill COMMISSION_VIEW/COMMISSION_APPROVE for existing SALES_MANAGER roles.
-- role-defaults.ts is only applied at tenant-provisioning time; this backfills tenants that
-- already exist. COMMISSION_MANAGE (plan/assignment authoring) deliberately stays
-- OWNER/ADMIN/SUPER_ADMIN-only (already covered by their TENANT_SCOPED_PERMISSIONS wildcard),
-- same split as the RULE_VIEW/RULE_CREATE backfill in migration 0151.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'COMMISSION_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'COMMISSION_APPROVE', r.tenant_id
FROM "roles" r
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
