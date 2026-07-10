-- Add updated_by audit column to branches, warehouses, organization_settings.
-- These tables previously tracked created_by but not who performed the last update.

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "updated_by" integer;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "updated_by" integer;
ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "updated_by" integer;
