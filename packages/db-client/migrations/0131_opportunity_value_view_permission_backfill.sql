-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0125, 0127, 0129).
-- CRM-ROADMAP Phase 3, Feature 6 (Field-level RBAC for CRM Records): OPPORTUNITY_VALUE_VIEW to
-- OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER — the same role set already holding OPPORTUNITY_VIEW,
-- so this backfill preserves today's behavior exactly rather than changing who sees what.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'OPPORTUNITY_VALUE_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
