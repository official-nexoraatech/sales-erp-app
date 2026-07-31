-- Backfill for existing tenants: role-defaults.ts only applies at tenant-provisioning time, so
-- tenants provisioned before this fix need this grant inserted directly (same bug class as
-- migrations 0076/0084).
--
-- CUSTOMER_BLOCK was a dead permission constant — defined but never checked by any route and
-- never granted to any role. This session wired it up to real POST /customers/:id/block and
-- /unblock routes (H-3 audit finding: customers.status='BLOCKED' was schema-valid but no code
-- path ever set it). SALES_MANAGER already holds CUSTOMER_EDIT and the credit-limit/price-floor
-- override permissions — the natural owner of a credit-risk blocking decision.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CUSTOMER_BLOCK', r.tenant_id
FROM "roles" r
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
