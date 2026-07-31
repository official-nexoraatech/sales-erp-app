-- Backfill for existing tenants: role-defaults.ts's grants only apply at NEW tenant-
-- provisioning time — existing tenants' already-stored role_permissions rows don't
-- retroactively pick up a constant added after they were provisioned (same recurring pattern as
-- migrations 0097, 0106, 0108, 0109, 0111, 0113, 0115, 0116, 0118, 0122, 0125).
-- CRM-ROADMAP Phase 2, Feature 4: REFERRAL_VIEW + REFERRAL_CONFIGURE to OWNER/ADMIN/
-- SUPER_ADMIN/SALES_MANAGER; REFERRAL_VIEW only (not CONFIGURE) to CASHIER — a cashier needs to
-- fetch a customer's referral code for the receipt QR, but not configure/review fraud.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('REFERRAL_VIEW'),
  ('REFERRAL_CONFIGURE')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'SALES_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'REFERRAL_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name = 'CASHIER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
