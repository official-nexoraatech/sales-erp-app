-- CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal). Structurally identical to the
-- Customer Portal trio (migration 0134) but kept as separate parallel tables — partner and
-- customer portal sessions must never be confused or replayed against the wrong table/role.
CREATE TABLE IF NOT EXISTS "crm_partner_accounts" (
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
  CONSTRAINT "crm_partner_accounts_customer_unique" UNIQUE ("tenant_id", "customer_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_partner_accounts_email"
  ON "crm_partner_accounts" ("tenant_id", "email");

CREATE TABLE IF NOT EXISTS "crm_partner_refresh_tokens" (
  "id" bigserial PRIMARY KEY,
  "partner_account_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_partner_refresh_tokens_hash" UNIQUE ("token_hash")
);
CREATE INDEX IF NOT EXISTS "idx_crm_partner_refresh_tokens_account"
  ON "crm_partner_refresh_tokens" ("partner_account_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_partner_password_tokens" (
  "id" bigserial PRIMARY KEY,
  "partner_account_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_partner_password_tokens_hash" UNIQUE ("token_hash")
);
CREATE INDEX IF NOT EXISTS "idx_crm_partner_password_tokens_account"
  ON "crm_partner_password_tokens" ("partner_account_id", "tenant_id");
