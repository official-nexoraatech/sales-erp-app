-- Backfill for existing tenants: role-defaults.ts's wildcard/explicit grants only apply at
-- NEW tenant-provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (see migrations 0097,
-- 0106, 0108, 0109, 0111, 0113, 0115 for the same recurring pattern).
-- CRM-ROADMAP Phase 1, Feature 8 grants CRM_DASHBOARD_VIEW to OWNER/ADMIN/SUPER_ADMIN (via
-- TENANT_SCOPED_PERMISSIONS) and to SALES_MANAGER (explicit grant, same role that already owns
-- the underlying Lead/Ticket/Campaign data this dashboard aggregates).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CRM_DASHBOARD_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
