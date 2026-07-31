-- CRM-ROADMAP Phase 4, Feature 4 (Territory Management).
CREATE TABLE IF NOT EXISTS "crm_territories" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_crm_territories_tenant"
  ON "crm_territories" ("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "crm_territory_branches" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "territory_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_territory_branches_unique" UNIQUE ("territory_id", "branch_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_territory_branches_territory"
  ON "crm_territory_branches" ("territory_id");
CREATE INDEX IF NOT EXISTS "idx_crm_territory_branches_branch"
  ON "crm_territory_branches" ("branch_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_territory_users" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "territory_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_territory_users_unique" UNIQUE ("territory_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_territory_users_territory"
  ON "crm_territory_users" ("territory_id");
CREATE INDEX IF NOT EXISTS "idx_crm_territory_users_user"
  ON "crm_territory_users" ("user_id", "tenant_id");

-- Extends the existing Phase 1 assignment-rule engine with a territory-scoped alternative to
-- branchId (see crm.ts's own comment on LeadService.autoAssign's resolution order).
ALTER TABLE "crm_assignment_rules" ADD COLUMN IF NOT EXISTS "territory_id" integer;
CREATE INDEX IF NOT EXISTS "idx_crm_assignment_rules_territory"
  ON "crm_assignment_rules" ("tenant_id", "is_active", "territory_id");
