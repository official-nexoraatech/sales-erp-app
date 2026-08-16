-- Multi-vertical platform audit 2026-08-16, Phase 3: posSessions tracks per-till cash
-- reconciliation only — there was no store-wide, cross-session Z-report/day-end settlement
-- across every till for a business day. New table, no existing data affected. The unique
-- constraint enforces one immutable settlement per tenant+branch+businessDate (a real
-- Z-reading can only be taken once).
CREATE TABLE "pos_day_end_settlements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"business_date" varchar(10) NOT NULL,
	"session_ids" jsonb NOT NULL,
	"session_count" integer NOT NULL,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"total_sales" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_tax" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_refunds" numeric(15, 2) DEFAULT '0' NOT NULL,
	"refund_count" integer DEFAULT 0 NOT NULL,
	"payment_mode_breakdown" jsonb NOT NULL,
	"opening_cash_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"closing_cash_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"expected_cash_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cash_variance_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"generated_by" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_day_end_settlements_tenant_branch_date" UNIQUE("tenant_id","branch_id","business_date")
);
CREATE INDEX "idx_pos_day_end_settlements_tenant_date" ON "pos_day_end_settlements" ("tenant_id","business_date");
