-- PG-020 (Session A) — tenant-scoped SSO configuration.
-- One row per tenant (v1: a tenant configures a single IdP at a time). `provider` is the
-- IdP identity for display purposes only — every option speaks OIDC underneath; SAML is a
-- separate, later package (see ERP-PLANNING/production-gap-prompts/002-Security/
-- 15-sso-oauth-saml.md). `client_secret_encrypted` follows the hr-service field-level-
-- encryption convention (AES-256-GCM via @erp/utils encryptField), never stored plaintext.

CREATE TABLE IF NOT EXISTS "sso_configs" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "provider" varchar(30) NOT NULL DEFAULT 'GENERIC_OIDC',
  "issuer_url" varchar(500) NOT NULL,
  "client_id" varchar(255) NOT NULL,
  "client_secret_encrypted" varchar(500) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "bypass_local_mfa" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "sso_configs_tenant_unique" UNIQUE ("tenant_id")
);

CREATE INDEX IF NOT EXISTS "idx_sso_configs_tenant" ON "sso_configs" ("tenant_id");

-- PG-020 (Session B prep): links a local user to the IdP subject claim that authenticated
-- them, populated on first successful SSO login rather than re-matching by email every
-- time. Schema only here — nothing writes these columns until the login/callback routes
-- ship.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sso_provider" varchar(30);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sso_subject" varchar(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_provider_subject'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_tenant_provider_subject" UNIQUE ("tenant_id", "sso_provider", "sso_subject");
  END IF;
END $$;
