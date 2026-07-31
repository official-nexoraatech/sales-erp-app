-- CRM-ROADMAP Phase 4, Feature 3 (Festival Intelligence AI) — fixes a pre-existing RBAC gap
-- found while implementing this feature: CRM_SEASON_VIEW/CRM_SEASON_MANAGE were never granted
-- to SALES_MANAGER in role-defaults.ts (grep-confirmed zero hits before this migration; already
-- flagged in ERP-PLANNING/production-readiness-audit-2026-07-25/05-crm.md as a known gap).
-- OWNER/ADMIN/SUPER_ADMIN already have both permissions via the TENANT_SCOPED_PERMISSIONS
-- wildcard in role-defaults.ts, so no backfill is needed for them — this feature's own
-- acceptance criteria ("merchandisers get useful suggestions") needs a non-OWNER role able to
-- view/approve seasons at all, and SALES_MANAGER is the closest existing role to "merchandiser"
-- (this system has no dedicated merchandiser role).
-- Same recurring pattern as migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118,
-- 0122, 0125, 0127, 0129, 0131, 0135, 0137, 0139.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('CRM_SEASON_VIEW'), ('CRM_SEASON_MANAGE')) AS p(permission)
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
