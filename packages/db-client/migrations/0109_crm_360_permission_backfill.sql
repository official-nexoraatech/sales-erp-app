-- Backfill for existing tenants: role-defaults.ts only applies at tenant-provisioning time
-- (see migrations 0097, 0106, 0108, ... for the same recurring pattern). CRM-ROADMAP Phase 1,
-- Feature 3 (Customer 360 Command Center) grants CRM_360_VIEW to the same roles that already
-- hold CUSTOMER_VIEW, EXCEPT DATA_OFFICER — that role's purpose is bulk export/compliance
-- operations, not the rep-facing health-score/quick-action command center this permission
-- gates, so it's deliberately excluded here (see role-defaults.ts's comment).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CRM_360_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'CASHIER', 'STAFF')
ON CONFLICT ("role_id", "permission") DO NOTHING;
