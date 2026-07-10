-- ES-12 Migration: Statutory HR — PF/ESI employee fields, EPS split, PF/ESI filing tracker
-- Take a DB backup before running this in production.

-- Step 1: Employee statutory fields
ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "uan" varchar(20),
  ADD COLUMN IF NOT EXISTS "esi_number" varchar(17),
  ADD COLUMN IF NOT EXISTS "pf_applicable" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "esi_applicable" boolean NOT NULL DEFAULT true;

-- Step 2: EPS split column on payroll_slips (employer PF = EPF + EPS; EPS tracked separately)
ALTER TABLE "payroll_slips"
  ADD COLUMN IF NOT EXISTS "eps_amount" decimal(15, 2) NOT NULL DEFAULT '0';

-- Step 3: PF/ESI challan filing tracker
CREATE TABLE IF NOT EXISTS "statutory_challan_filings" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "challan_type" varchar(10) NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "filed_at" timestamptz NOT NULL,
  "filed_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "statutory_challan_filings_tenant_type_period" UNIQUE("tenant_id", "challan_type", "period_month", "period_year")
);

CREATE INDEX IF NOT EXISTS "idx_statutory_challan_filings_tenant"
  ON "statutory_challan_filings" ("tenant_id", "challan_type", "period_year");
