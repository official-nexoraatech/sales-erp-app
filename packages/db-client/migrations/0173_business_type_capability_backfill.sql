-- Phase 12 expansion-framework review (2026-08-20): business_types.default_capability_keys was
-- seeded (migrations 0170, 0172) but never actually kept in sync with what a tenant of that
-- business type really gets at provisioning time, which draws from THREE sources, not one:
-- (1) apps/tenant-service/src/rbac/vertical-defaults.ts's VERTICAL_DEFAULTS (per-vertical
-- overrides), (2) TenantProvisioner's own baseFlags code array (tenant-scoped defaults written
-- for every tenant regardless of vertical), and (3) separately-seeded GLOBAL feature_flags
-- defaults (tenant_id IS NULL rows, e.g. migration 0169's inventory.batch.enabled=true) for any
-- flag that (1) and (2) never write a tenant-scoped row for at all. INVENTORY_BATCH falls
-- entirely into bucket (3) for CLOTH_RETAIL/GROCERY (neither VERTICAL_DEFAULTS nor baseFlags
-- ever mention inventory.batch.enabled for them) — a real, live-verified effective default
-- (apps/tenant-service/src/__tests__/business-type-capability-consistency.test.ts provisions a
-- real tenant per vertical and asserts this), not a static guess. Data-only, idempotent (plain
-- UPDATE by unique code). See ERP-PLANNING/multi-industry-platform/22-phase12-expansion-
-- framework-review.md.

UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "POS", "INVENTORY_BATCH"]'::jsonb
WHERE code = 'CLOTH_RETAIL';

UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "POS", "INVENTORY_BATCH"]'::jsonb
WHERE code = 'GROCERY';

UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "INVENTORY_BATCH"]'::jsonb
WHERE code = 'DISTRIBUTION';
