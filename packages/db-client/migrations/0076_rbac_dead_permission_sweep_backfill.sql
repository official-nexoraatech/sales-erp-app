-- Backfill for existing tenants: role-defaults.ts-omission RBAC bugs found in a follow-up
-- systematic sweep of the same bug class as migration 0075 (grant a permission that
-- *sounds* right, but the route actually checks a different constant, silently locking the
-- role out of a working feature). role-defaults.ts only applies at tenant-provisioning time,
-- so tenants provisioned before this fix need these grants inserted directly.
--
-- 1. ACCOUNTANT / ACCOUNTANT_SUPERVISOR held GST_FILE + GSTR9_VIEW/FILE but not
--    GSTR1_*/GSTR3B_* — gst-service's gstr1.routes.ts/gstr3b.routes.ts check the latter,
--    locking both roles out of the monthly/quarterly returns (their core job).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('GSTR1_VIEW'), ('GSTR1_FILE'), ('GSTR3B_VIEW'), ('GSTR3B_FILE')) AS p(permission)
WHERE r.name IN ('ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 2. ACCOUNTANT / ACCOUNTANT_SUPERVISOR — TDS module (accounting-service's tds.routes.ts)
--    was entirely unreachable; neither role held TDS_VIEW/TDS_MANAGE.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('TDS_VIEW'), ('TDS_MANAGE')) AS p(permission)
WHERE r.name IN ('ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 3. INVENTORY_MANAGER held STOCK_ADJUST/STOCK_TRANSFER (can create/approve) but not the
--    granular *_VIEW constants report-service and search-service actually check, so this
--    role couldn't see its own reports or find its own transactions in Global Search.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES ('STOCK_ADJUSTMENT_VIEW'), ('STOCK_TRANSFER_VIEW'), ('PHYSICAL_VERIFICATION_VIEW'),
         ('FABRIC_ROLL_VIEW'), ('REORDER_VIEW')
) AS p(permission)
WHERE r.name = 'INVENTORY_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 4. HR_MANAGER — hr-service's /attendance/report and /attendance/team-summary check
--    ATTENDANCE_REPORT, not ATTENDANCE_VIEW; the whole Alterations module (10 endpoints)
--    had no ALTERATION_* grant at all.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES ('ATTENDANCE_REPORT'), ('ALTERATION_VIEW'), ('ALTERATION_CREATE'), ('ALTERATION_UPDATE')
) AS p(permission)
WHERE r.name = 'HR_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 5. PURCHASE_MANAGER — production-service's Reorder Report + "create PO from reorder"
--    were unreachable; this role owns PO creation, so it gets both the view and the
--    create-PO action.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('REORDER_VIEW'), ('REORDER_CREATE_PO')) AS p(permission)
WHERE r.name = 'PURCHASE_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 6. SALES_MANAGER — the Customer Loyalty Report is gated on CRM_LOYALTY_VIEW, not
--    CUSTOMER_VIEW/POS_MANAGE (both already held) — this role could run loyalty operations
--    but never see the report on them.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CRM_LOYALTY_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
