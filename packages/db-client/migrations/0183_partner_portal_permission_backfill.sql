-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migration 0135 and its own predecessors).
-- CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal).
-- PARTNER_ACCOUNT_MANAGE (staff provisioning of a partner login for a WHOLESALE/B2B customer)
-- to OWNER/ADMIN/SUPER_ADMIN, matching PORTAL_ACCOUNT_MANAGE's role set (migration 0135).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'PARTNER_ACCOUNT_MANAGE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- IMPERSONATE_PARTNER is deliberately withheld from ADMIN, matching
-- IMPERSONATE_PORTAL_CUSTOMER's own precedent (migration 0135) — logging in as a partner is
-- sensitive enough to reserve for OWNER/SUPER_ADMIN only.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'IMPERSONATE_PARTNER', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;
