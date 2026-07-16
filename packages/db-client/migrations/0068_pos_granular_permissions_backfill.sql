-- Wire up the granular POS_ACCESS/POS_OPEN_SHIFT/POS_CLOSE_SHIFT/POS_CASH_DRAWER
-- permission constants for existing tenants (role-defaults.ts is only applied at
-- tenant-provisioning time).
--
-- Root cause (flagged in qa_pos_frontend_module_2026-07-13, fixed here): every POS route
-- in apps/sales-service/src/api/pos.routes.ts and report-service's /api/v2/pos-analytics
-- accepted only PERMISSIONS.POS_MANAGE, even though POS_ACCESS/POS_OPEN_SHIFT/
-- POS_CLOSE_SHIFT/POS_APPLY_DISCOUNT/POS_VOID_BILL/POS_CASH_DRAWER all already existed as
-- defined constants — meaning any cashier who could use the till at all could also see the
-- cash-drawer report, with no separate supervisor-tier gate. Routes now accept
-- requireAnyPermission([POS_MANAGE, <granular>]) so this backfill only needs to touch the
-- CASHIER role: give it the granular till-operator permissions, and revoke the broad
-- POS_MANAGE grant that previously gave it (unintended) cash-drawer visibility too.
-- SALES_MANAGER/ADMIN/OWNER keep POS_MANAGE untouched — they still get everything,
-- including POS_CASH_DRAWER, via the requireAnyPermission fallback.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'POS_ACCESS', r.tenant_id
FROM "roles" r
WHERE r.name = 'CASHIER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'POS_OPEN_SHIFT', r.tenant_id
FROM "roles" r
WHERE r.name = 'CASHIER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'POS_CLOSE_SHIFT', r.tenant_id
FROM "roles" r
WHERE r.name = 'CASHIER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

DELETE FROM "role_permissions"
WHERE "permission" = 'POS_MANAGE'
  AND "role_id" IN (SELECT id FROM "roles" WHERE name = 'CASHIER');
