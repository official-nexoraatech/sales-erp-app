-- Business Rules Engine, Commission category: genuinely new domain capability (no prior
-- commission-calculation logic existed anywhere in the codebase). See
-- apps/sales-service/src/domain/CommissionService.ts and packages/platform-sdk/src/rule-engine.ts.
CREATE TABLE IF NOT EXISTS "commission_plans" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "calculation_basis" varchar(20) NOT NULL,
  "rate_pct" numeric(5, 2),
  "flat_amount" numeric(12, 2),
  "tier_slabs" jsonb,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_till" timestamp with time zone,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_commission_plans_tenant" ON "commission_plans" ("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "commission_assignments" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "plan_id" integer NOT NULL,
  "user_id" integer,
  "role_name" varchar(100),
  "branch_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_commission_assignments_tenant_user" ON "commission_assignments" ("tenant_id", "user_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_commission_assignments_tenant_branch" ON "commission_assignments" ("tenant_id", "branch_id", "is_active");

CREATE TABLE IF NOT EXISTS "commission_ledger" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "plan_id" integer NOT NULL,
  "assignment_id" integer NOT NULL,
  "earned_by_user_id" integer NOT NULL,
  "base_amount" numeric(14, 2) NOT NULL,
  "commission_amount" numeric(12, 2) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "approved_by" integer,
  "approved_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_commission_ledger_tenant_invoice" ON "commission_ledger" ("tenant_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "idx_commission_ledger_tenant_earner" ON "commission_ledger" ("tenant_id", "earned_by_user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_commission_ledger_tenant_status" ON "commission_ledger" ("tenant_id", "status");
