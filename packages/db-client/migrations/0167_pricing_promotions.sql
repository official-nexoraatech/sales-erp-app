-- Multi-vertical platform audit 2026-08-16, Phase 2: no multi-buy/bundle/tiered-pricing engine
-- existed anywhere in sales-service — only a flat per-line/per-order percentage discount.
-- Grocery retail relies heavily on "buy 2 get 1 free" style deals. New table, no existing data
-- affected.
CREATE TABLE "pricing_promotions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"promotion_type" varchar(30) NOT NULL,
	"item_id" integer,
	"category_id" integer,
	"buy_quantity" integer NOT NULL,
	"get_quantity" integer NOT NULL,
	"get_discount_pct" numeric(5, 2) DEFAULT '100' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
CREATE INDEX "idx_pricing_promotions_tenant_item" ON "pricing_promotions" ("tenant_id","is_active","item_id");
CREATE INDEX "idx_pricing_promotions_tenant_category" ON "pricing_promotions" ("tenant_id","is_active","category_id");
