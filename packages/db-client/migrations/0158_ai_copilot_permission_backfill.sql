-- Backfill COPILOT_VIEW/COPILOT_USE for existing SALES_MANAGER/PURCHASE_MANAGER/ACCOUNTANT/
-- INVENTORY_MANAGER/HR_MANAGER roles. role-defaults.ts is only applied at tenant-provisioning
-- time; this backfills tenants that already exist. CASHIER/STAFF/ACCOUNTANT_SUPERVISOR/
-- AUDITOR/DATA_OFFICER are deliberately not included in this pass — a follow-up, not a gap
-- silently left unaddressed (see the plan file's Feature 3 section).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, perm.name, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('COPILOT_VIEW'), ('COPILOT_USE')) AS perm(name)
WHERE r.name IN ('SALES_MANAGER', 'PURCHASE_MANAGER', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'HR_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
