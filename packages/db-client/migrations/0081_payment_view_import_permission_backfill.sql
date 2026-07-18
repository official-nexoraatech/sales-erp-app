-- Backfill for existing tenants: role-defaults.ts-omission RBAC gaps found in the
-- report-service and scheduler-service audits (same bug class as migrations
-- 0075/0076/0078/0079).
--
-- 1. report-service's Payment Collection Report checks the single, broader PAYMENT_VIEW
--    constant, not PAYMENT_IN_VIEW/PAYMENT_OUT_VIEW — ACCOUNTANT/ACCOUNTANT_SUPERVISOR/
--    AUDITOR could all see payment records via sales-service's routes (which accept either)
--    but 403'd on the report specifically about them.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'PAYMENT_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR', 'AUDITOR')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 2. scheduler-service's bulk CSV import (IMPORT_VIEW/IMPORT_EXECUTE/IMPORT_ROLLBACK) was
--    unreachable for every role that actually owns an importable entity type — effectively
--    OWNER/ADMIN-only despite each entity's normal CRUD already being delegated.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('IMPORT_VIEW'), ('IMPORT_EXECUTE'), ('IMPORT_ROLLBACK')) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'PURCHASE_MANAGER', 'INVENTORY_MANAGER', 'HR_MANAGER', 'DATA_OFFICER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 3. EMPLOYEE_IMPORT is an additional, entity-specific gate ImportEngine checks only for the
--    employee entity type, on top of the generic IMPORT_EXECUTE above — HR_MANAGER needs
--    both to actually run an employee CSV import.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'EMPLOYEE_IMPORT', r.tenant_id
FROM "roles" r
WHERE r.name = 'HR_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
