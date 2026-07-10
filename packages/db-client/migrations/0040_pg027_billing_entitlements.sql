-- PG-027 Session 1: plan/entitlement/billing schema.
-- plan_entitlements is a global tier template (no tenant_id) copied into a tenant's
-- settings/feature_flags at provisioning/plan-change time — see BillingService.
-- tenant_invoices is a tenant-billing invoice, distinct from sales-service's own
-- customer-facing `invoices` table; do not confuse the two.
-- Seeded values below are illustrative only, pending product-owner pricing confirmation.

CREATE TABLE IF NOT EXISTS "plan_entitlements" (
  "id" bigserial PRIMARY KEY,
  "plan" varchar(50) UNIQUE NOT NULL,
  "max_users" integer,
  "max_branches" integer,
  "feature_flags" jsonb NOT NULL DEFAULT '[]',
  "monthly_price_paise" integer,
  "billing_period" varchar(20) NOT NULL DEFAULT 'MONTHLY',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_invoices" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "plan" varchar(50) NOT NULL,
  "amount_paise" integer NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'INR',
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "billing_period_start" date NOT NULL,
  "billing_period_end" date NOT NULL,
  "payment_gateway_ref" varchar(200),
  "paid_at" timestamp with time zone,
  "failure_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_invoices_tenant" ON "tenant_invoices"("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_invoices_billing_period" ON "tenant_invoices"("tenant_id", "billing_period_start");
--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "next_billing_date" date;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "dunning_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "payment_gateway_customer_ref" varchar(200);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenants_next_billing_date" ON "tenants"("next_billing_date");
--> statement-breakpoint

-- Illustrative placeholder entitlements — pricing/limits pending product-owner confirmation.
INSERT INTO "plan_entitlements" ("plan", "max_users", "max_branches", "feature_flags", "billing_period")
VALUES
  ('STARTER', 5, 1, '["sales.quotations.enabled", "sales.credit-limit.enabled", "accounting.auto-journal.enabled", "notification.email.enabled", "notification.sms.enabled"]', 'MONTHLY'),
  ('GROWTH', 25, 5, '["sales.quotations.enabled", "sales.credit-limit.enabled", "accounting.auto-journal.enabled", "notification.email.enabled", "notification.sms.enabled", "multi-branch.enabled", "gst.e-invoice.enabled", "gst.eway-bill.enabled", "pos.enabled"]', 'MONTHLY'),
  ('ENTERPRISE', NULL, NULL, '["sales.quotations.enabled", "sales.credit-limit.enabled", "accounting.auto-journal.enabled", "notification.email.enabled", "notification.sms.enabled", "multi-branch.enabled", "gst.e-invoice.enabled", "gst.eway-bill.enabled", "pos.enabled", "hr.payroll.enabled", "hr.attendance.enabled", "notification.whatsapp.enabled"]', 'MONTHLY')
ON CONFLICT ("plan") DO NOTHING;
