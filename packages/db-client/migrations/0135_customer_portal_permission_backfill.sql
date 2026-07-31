-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0125, 0127, 0129, 0131).
-- CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal).
-- PORTAL_ACCOUNT_MANAGE (staff provisioning of a customer's portal login) to OWNER/ADMIN/
-- SUPER_ADMIN, matching the role set most other admin-config permissions in this file use.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'PORTAL_ACCOUNT_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- IMPERSONATE_PORTAL_CUSTOMER is deliberately withheld from ADMIN, matching the existing
-- IMPERSONATE_USER precedent (role-defaults.ts explicitly excludes IMPERSONATE_USER from ADMIN's
-- otherwise-everything grant) — logging in as a customer is sensitive enough to reserve for
-- OWNER/SUPER_ADMIN only.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'IMPERSONATE_PORTAL_CUSTOMER', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
