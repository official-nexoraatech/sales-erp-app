-- Backfill PAYMENT_VIEW/PAYMENT_CREATE for existing SALES_MANAGER and CASHIER roles.
--
-- Root cause: apps/tenant-service/src/rbac/role-defaults.ts assigned these roles the
-- constants PAYMENT_IN_VIEW/PAYMENT_IN_CREATE, which no backend route ever checks (the
-- actual GET/POST /payments routes in apps/sales-service/src/api/payment.routes.ts require
-- PAYMENT_VIEW/PAYMENT_CREATE) and no frontend route ever references. Net effect: every
-- SALES_MANAGER and CASHIER got a full Access Denied on the entire Payments page/route.
-- role-defaults.ts now assigns PAYMENT_VIEW/PAYMENT_CREATE directly; this backfills tenants
-- that already exist (role-defaults.ts is only applied at tenant-provisioning time).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'PAYMENT_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'CASHIER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'PAYMENT_CREATE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'CASHIER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
