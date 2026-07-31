-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0125, 0127, 0129, 0131,
-- 0135, 0137).
-- CRM-ROADMAP Phase 4, Feature 5 (Sales Forecasting & Quota Management): both new permissions to
-- OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER — the same role set TERRITORY_MANAGE already uses.
-- QUOTA_VALUE_VIEW granted alongside QUOTA_MANAGE for every existing role (no behavior change
-- today, same "reachable by a future custom role" precedent as OPPORTUNITY_VALUE_VIEW).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('QUOTA_MANAGE'), ('QUOTA_VALUE_VIEW')) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
