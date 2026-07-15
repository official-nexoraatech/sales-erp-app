-- CP-7: CRM_CAMPAIGN_APPROVE is a new permission constant. role-defaults.ts's
-- TENANT_SCOPED_PERMISSIONS wildcard (OWNER/ADMIN/SUPER_ADMIN) is only evaluated against
-- whatever constants exist in packages/shared-types/src/permissions.ts at tenant-provisioning
-- time — same gap as prior permission-backfill migrations (e.g. 0050). Backfill for existing
-- tenants; new tenants get it for free via role-defaults.ts.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('CRM_CAMPAIGN_APPROVE')) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
