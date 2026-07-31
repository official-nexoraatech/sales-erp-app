-- Backfill for existing tenants: role-defaults.ts's wildcard/explicit grants only apply at
-- NEW tenant-provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (see migrations 0097,
-- 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0137, 0139, 0141 for the same recurring
-- pattern).
-- CRM-ROADMAP Phase 4, Feature 8 grants API_KEY_MANAGE to OWNER/ADMIN/SUPER_ADMIN only (via
-- TENANT_SCOPED_PERMISSIONS) — deliberately no SALES_MANAGER grant, see permissions.ts's own
-- comment on why this is a platform-governance action, not a Sales Ops one.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('API_KEY_MANAGE')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
