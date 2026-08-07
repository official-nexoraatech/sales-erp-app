-- Backfill RULE_*/COMMISSION_*/AUTOMATION_*/COPILOT_* for existing OWNER/ADMIN/SUPER_ADMIN
-- roles.
--
-- Root cause: migrations 0151, 0154, 0156, 0158 only backfilled manager roles (SALES_MANAGER/
-- PURCHASE_MANAGER/ACCOUNTANT/INVENTORY_MANAGER/HR_MANAGER), on the assumption that OWNER/
-- ADMIN/SUPER_ADMIN already had these permissions via role-defaults.ts's TENANT_SCOPED_PERMISSIONS
-- wildcard. That wildcard is only evaluated in code at tenant-provisioning time — an existing
-- tenant's OWNER/ADMIN/SUPER_ADMIN role_permissions rows were snapshotted before these
-- permission constants existed, so they never retroactively gained them. This is the same class
-- of bug migration 0023 (DASHBOARD_VIEW) already fixed and documented; those four migrations
-- should have followed that same OWNER/ADMIN/SUPER_ADMIN-inclusive pattern and didn't.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, perm.name, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('RULE_VIEW'), ('RULE_CREATE'), ('RULE_UPDATE'), ('RULE_DELETE'), ('RULE_SIMULATE'),
  ('COMMISSION_VIEW'), ('COMMISSION_MANAGE'), ('COMMISSION_APPROVE'),
  ('AUTOMATION_VIEW'), ('AUTOMATION_CREATE'), ('AUTOMATION_EDIT'), ('AUTOMATION_DELETE'), ('AUTOMATION_EXECUTE'),
  ('COPILOT_VIEW'), ('COPILOT_USE')
) AS perm(name)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
