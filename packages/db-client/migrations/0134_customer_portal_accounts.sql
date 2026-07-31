-- CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal).
CREATE TABLE IF NOT EXISTS "crm_portal_accounts" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "email" varchar(320) NOT NULL,
  "password_hash" varchar(200) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "must_reset_password" boolean NOT NULL DEFAULT true,
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_portal_accounts_customer_unique" UNIQUE ("tenant_id", "customer_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_portal_accounts_email"
  ON "crm_portal_accounts" ("tenant_id", "email");

CREATE TABLE IF NOT EXISTS "crm_portal_refresh_tokens" (
  "id" bigserial PRIMARY KEY,
  "portal_account_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_portal_refresh_tokens_hash" UNIQUE ("token_hash")
);
CREATE INDEX IF NOT EXISTS "idx_crm_portal_refresh_tokens_account"
  ON "crm_portal_refresh_tokens" ("portal_account_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_portal_password_tokens" (
  "id" bigserial PRIMARY KEY,
  "portal_account_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_portal_password_tokens_hash" UNIQUE ("token_hash")
);
CREATE INDEX IF NOT EXISTS "idx_crm_portal_password_tokens_account"
  ON "crm_portal_password_tokens" ("portal_account_id", "tenant_id");

-- A portal-created ticket has no staff users.id author; created_by is now nullable and a
-- sibling portal-account column is added. Existing rows keep their non-null created_by.
ALTER TABLE "crm_tickets" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "crm_tickets" ADD COLUMN IF NOT EXISTS "created_by_portal_account_id" integer;
