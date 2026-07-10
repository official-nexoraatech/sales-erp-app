-- PG-026: persisted daily snapshots for two converted scheduler jobs
-- (accounting.trial-balance.snapshot, inventory.stock-value-report) that
-- previously only logged a message with no computation or storage.
CREATE TABLE "trial_balance_snapshots" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "as_of_date" date NOT NULL,
  "total_debit" numeric(15, 2) NOT NULL,
  "total_credit" numeric(15, 2) NOT NULL,
  "is_balanced" boolean NOT NULL,
  "account_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trial_balance_snapshots_tenant_date" UNIQUE ("tenant_id", "as_of_date")
);
--> statement-breakpoint
CREATE INDEX "idx_trial_balance_snapshots_tenant" ON "trial_balance_snapshots"("tenant_id", "as_of_date");
--> statement-breakpoint

CREATE TABLE "stock_valuation_snapshots" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "as_of_date" date NOT NULL,
  "total_stock_value" numeric(15, 2) NOT NULL,
  "item_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "stock_valuation_snapshots_tenant_date" UNIQUE ("tenant_id", "as_of_date")
);
--> statement-breakpoint
CREATE INDEX "idx_stock_valuation_snapshots_tenant" ON "stock_valuation_snapshots"("tenant_id", "as_of_date");
