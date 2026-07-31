-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0125, 0127).
-- CRM-ROADMAP Phase 2, Feature 5: CONVERSATION_VIEW/REPLY/ASSIGN to OWNER/ADMIN/SUPER_ADMIN/
-- SALES_MANAGER — same role set as every prior CRM feature's own backfill (CASHIER doesn't get
-- these, matching it never holding TICKET_* either).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('CONVERSATION_VIEW'),
  ('CONVERSATION_REPLY'),
  ('CONVERSATION_ASSIGN')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
