-- ES-06 Migration: Encrypt payslip salary columns + Holiday Calendars
-- IMPORTANT: Run data migration script (tools/scripts/migrate-payslip-encryption.ts)
-- in DRY-RUN mode first, then EXECUTE mode AFTER applying this schema migration.
-- Take a DB backup before running this in production.

-- Step 1: Change grossSalary and netSalary to text to store AES-256-GCM ciphertext
ALTER TABLE "payroll_slips"
  ALTER COLUMN "gross_salary" TYPE text USING "gross_salary"::text,
  ALTER COLUMN "gross_salary" SET DEFAULT '',
  ALTER COLUMN "net_salary" TYPE text USING "net_salary"::text,
  ALTER COLUMN "net_salary" SET DEFAULT '';

-- Step 2: Create holiday_calendars table
CREATE TABLE IF NOT EXISTS "holiday_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "holiday_date" date NOT NULL,
  "holiday_type" varchar(20) NOT NULL,
  "branch_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "holiday_calendars_tenant_name_date" UNIQUE("tenant_id", "name", "holiday_date")
);

CREATE INDEX IF NOT EXISTS "idx_holiday_calendars_tenant_date"
  ON "holiday_calendars" ("tenant_id", "holiday_date");
