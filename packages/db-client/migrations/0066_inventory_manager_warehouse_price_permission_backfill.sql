-- Backfill WAREHOUSE_MANAGE/PRICE_LIST_VIEW for existing INVENTORY_MANAGER roles.
--
-- Root cause: apps/tenant-service/src/rbac/role-defaults.ts granted INVENTORY_MANAGER
-- WAREHOUSE_VIEW/CREATE/UPDATE but not WAREHOUSE_MANAGE, while
-- apps/inventory-service/src/api/warehouse.routes.ts's manage route requires
-- WAREHOUSE_MANAGE — and apps/inventory-service/src/api/sync.routes.ts requires
-- PRICE_LIST_VIEW, also never granted. Both constants already existed (OWNER/ADMIN already
-- have them via their full-permission spread) — this was a role-defaults.ts omission, not a
-- new permission. role-defaults.ts now grants both to INVENTORY_MANAGER; this backfills
-- tenants that already exist (role-defaults.ts is only applied at tenant-provisioning time).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'WAREHOUSE_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name = 'INVENTORY_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'PRICE_LIST_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name = 'INVENTORY_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
