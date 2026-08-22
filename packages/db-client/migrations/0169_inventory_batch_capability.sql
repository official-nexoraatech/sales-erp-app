-- Phase 2B: INVENTORY_BATCH capability — data-only migration, no DDL. The batch/expiry schema
-- already shipped in 0165_inventory_batch_expiry_fefo.sql; this seeds the capability's backing
-- feature flag and backfills existing tenants' role permissions.

-- 1. Global default for 'inventory.batch.enabled' — TRUE. This preserves current de facto
--    behavior: GRNService has always captured batch/expiry data unconditionally when a GRN line
--    provides it, and nearExpiryAlert.job.ts already alerts on it independent of this flag. No
--    existing item has fefoEnabled = true (that write path doesn't exist before this phase), so
--    defaulting the capability itself to true changes zero existing tenant's consumption
--    behavior — it only removes a redundant admin step before an item can be opted into FEFO.
INSERT INTO "feature_flags" ("tenant_id", "flag_key", "enabled")
SELECT NULL, 'inventory.batch.enabled', true
WHERE NOT EXISTS (
  SELECT 1 FROM "feature_flags" WHERE "tenant_id" IS NULL AND "flag_key" = 'inventory.batch.enabled'
);
--> statement-breakpoint

-- 2. Permission backfill — ROLE_DEFAULTS (tenant-service, code) only applies at new-tenant
--    provisioning; existing tenants' role_permissions rows must be updated directly or their
--    INVENTORY_MANAGER/OWNER/ADMIN/SUPER_ADMIN/PURCHASE_MANAGER roles grant BATCH_VIEW/
--    BATCH_CONFIGURE in code but not in stored permissions (same class of gap as migration
--    0159's OWNER/ADMIN/SUPER_ADMIN backfill).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, perm.name, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('BATCH_VIEW'), ('BATCH_CONFIGURE')
) AS perm(name)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'INVENTORY_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'BATCH_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name = 'PURCHASE_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
