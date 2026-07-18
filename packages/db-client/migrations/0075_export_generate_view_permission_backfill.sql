-- Backfill EXPORT_GENERATE/EXPORT_VIEW for existing SALES_MANAGER/ACCOUNTANT/
-- ACCOUNTANT_SUPERVISOR/AUDITOR/DATA_OFFICER roles.
--
-- Root cause: apps/tenant-service/src/rbac/role-defaults.ts granted these roles
-- REPORT_EXPORT (and, for ACCOUNTANT_SUPERVISOR/AUDITOR, LEDGER_EXPORT) believing it gated
-- bulk data export — but neither constant is checked anywhere. The real bulk-export feature
-- (scheduler-service's POST /exports/generate, GET /exports/:jobId/download|status) checks
-- EXPORT_GENERATE/EXPORT_VIEW instead, which none of these roles held. Every non-admin role
-- was silently locked out of bulk CSV/XLSX export despite their role clearly being granted
-- "export" access. Same role-defaults.ts-omission pattern as migration 0066
-- (INVENTORY_MANAGER/WAREHOUSE_MANAGE) — role-defaults.ts now grants both constants to these
-- roles; this backfills tenants that already exist (role-defaults.ts only applies at
-- tenant-provisioning time).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'EXPORT_GENERATE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR', 'AUDITOR', 'DATA_OFFICER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'EXPORT_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR', 'AUDITOR', 'DATA_OFFICER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
