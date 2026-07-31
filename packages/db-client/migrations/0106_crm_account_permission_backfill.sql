-- Backfill for existing tenants: role-defaults.ts only applies at tenant-provisioning time
-- (see migrations 0097, 0084, 0078, ... for the same recurring pattern). CRM-ROADMAP Phase 1,
-- Feature 1 grants CRM_ACCOUNT_VIEW/CREATE/UPDATE/MERGE to SALES_MANAGER — this backfills
-- those four grants for tenants provisioned before this change.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, v.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('CRM_ACCOUNT_VIEW'),
  ('CRM_ACCOUNT_CREATE'),
  ('CRM_ACCOUNT_UPDATE'),
  ('CRM_ACCOUNT_MERGE')
) AS v(permission)
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
