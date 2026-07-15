-- CP-7: CRM_CAMPAIGN_ANALYTICS_VIEW and CRM_AUTOMATION_MANAGE are new permission constants.
-- Same backfill gap as 0057 — role-defaults.ts's TENANT_SCOPED_PERMISSIONS wildcard only covers
-- tenants provisioned after these constants existed. Backfill for existing tenants; new tenants
-- get both for free via role-defaults.ts.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('CRM_CAMPAIGN_ANALYTICS_VIEW'), ('CRM_AUTOMATION_MANAGE')) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
