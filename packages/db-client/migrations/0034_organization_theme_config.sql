-- Add tenant theme/branding config to organization_settings.
-- Powers ERP-PLANNING/05_ERP_THEME_SYSTEM.md §4 (tenant branding) — a JSONB blob of the
-- small, enumerated set of brand tokens a tenant may override (never layout/spacing/status
-- colors — see §4.2 for what's deliberately excluded).

ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "theme_config" jsonb;
