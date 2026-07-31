-- Backfill for existing tenants: role-defaults.ts only applies at tenant-provisioning time
-- (see migrations 0097, 0106, 0108, 0109, ... for the same recurring pattern). CRM-ROADMAP
-- Phase 1, Feature 4 grants TICKET_VIEW/CREATE/UPDATE/ASSIGN/RESOLVE/DELETE to SALES_MANAGER —
-- this backfills those grants for tenants provisioned before this change.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, v.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('TICKET_VIEW'),
  ('TICKET_CREATE'),
  ('TICKET_UPDATE'),
  ('TICKET_ASSIGN'),
  ('TICKET_RESOLVE'),
  ('TICKET_DELETE')
) AS v(permission)
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
