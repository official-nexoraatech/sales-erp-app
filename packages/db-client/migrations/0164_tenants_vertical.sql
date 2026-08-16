-- Multi-vertical platform audit 2026-08-16: tenants had no concept of which business vertical
-- (cloth retail, grocery, ...) they operate in, so TenantProvisioner unconditionally seeded the
-- same role set and feature flags for every tenant. Defaults to CLOTH_RETAIL so every
-- already-provisioned tenant keeps today's behavior unchanged.
ALTER TABLE "tenants" ADD COLUMN "vertical" varchar(20) DEFAULT 'CLOTH_RETAIL' NOT NULL;
