-- QA session (2026-07-12, Sales/Order-to-Cash deep dive): SALES_MANAGER's role-defaults.ts
-- list has always granted QUOTATION_VIEW/CREATE/UPDATE/CANCEL but never QUOTATION_CONVERT —
-- the one permission /quotations/:id/convert actually checks. Confirmed live: zero
-- SALES_MANAGER roles across all 5 tenants with that role had it. OWNER/ADMIN/SUPER_ADMIN
-- already have it via the TENANT_SCOPED_PERMISSIONS wildcard; this backfill only needed for
-- SALES_MANAGER. New tenants get it for free via role-defaults.ts. Same gap class as
-- 0038_pg020_sso_config_manage_permission_backfill.sql / 0050_pg037_cost_center_permission_backfill.sql.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'QUOTATION_CONVERT', r.tenant_id
FROM "roles" r
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
