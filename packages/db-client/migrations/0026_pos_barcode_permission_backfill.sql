-- Backfill POS_MANAGE for existing CASHIER/SALES_MANAGER roles, and BARCODE_VIEW/
-- BARCODE_GENERATE/BARCODE_PRINT for existing INVENTORY_MANAGER roles.
--
-- Root cause: apps/tenant-service/src/rbac/role-defaults.ts never granted POS_MANAGE
-- (required by every route in apps/sales-service/src/api/pos.routes.ts — sessions,
-- quick-items, customer-search, sales) or any BARCODE_* permission (required by
-- apps/production-service/src/api/barcode.routes.ts) to any operational role — only
-- OWNER/ADMIN had them via the blanket Object.values(PERMISSIONS) grant. Net effect:
-- no cashier or inventory-management account could use the POS screen or the
-- barcode-label features at all. role-defaults.ts now grants these directly; this
-- backfills tenants that already exist (role-defaults.ts only applies at
-- tenant-provisioning time).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'POS_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('CASHIER', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('BARCODE_VIEW'), ('BARCODE_GENERATE'), ('BARCODE_PRINT')) AS p(permission)
WHERE r.name = 'INVENTORY_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
