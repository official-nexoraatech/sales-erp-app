-- 2026-07-20 HR module audit: three genuinely-missing enterprise HR entities.
--
-- 1. employee_nominees — no nominee (PF/gratuity beneficiary) table existed at all.
-- 2. employee_exits — employees.status/exit_date/exit_reason only recorded THAT an
--    employee exited, with no notice-period tracking, clearance checklist, or Full &
--    Final settlement breakup/status.
-- 3. employee_history — department/designation/branch/manager were current-state-only
--    columns on employees with zero audit trail of past increments/promotions/transfers.
CREATE TABLE IF NOT EXISTS "employee_nominees" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "relationship" varchar(50) NOT NULL,
  "date_of_birth" date,
  "contact_number" varchar(20),
  "address" text,
  "share_percentage" decimal(5, 2) NOT NULL DEFAULT '100',
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_employee_nominees_employee" ON "employee_nominees" ("employee_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "employee_exits" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "resignation_date" date NOT NULL,
  "last_working_date" date NOT NULL,
  "notice_period_days" integer NOT NULL DEFAULT 30,
  "exit_reason" text,
  "clearance_status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "cleared_by" integer,
  "cleared_at" timestamptz,
  "pro_rated_salary_amount" decimal(15, 2),
  "leave_encashment_amount" decimal(15, 2),
  "loan_recovery_amount" decimal(15, 2),
  "fnf_total_amount" decimal(15, 2),
  "fnf_status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "fnf_settled_by" integer,
  "fnf_settled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "employee_exits_employee" UNIQUE ("tenant_id", "employee_id")
);
CREATE INDEX IF NOT EXISTS "idx_employee_exits_tenant" ON "employee_exits" ("tenant_id", "fnf_status");

CREATE TABLE IF NOT EXISTS "employee_history" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "change_type" varchar(30) NOT NULL,
  "effective_date" date NOT NULL,
  "previous_value" jsonb NOT NULL,
  "new_value" jsonb NOT NULL,
  "reason" text,
  "approved_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_employee_history_employee" ON "employee_history" ("employee_id", "tenant_id", "effective_date");
