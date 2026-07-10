-- PG-045: employee loans (flat-EMI, no-interest salary advances) + per-payslip
-- deduction history. Fully tenant-scoped (unlike PG-044's global pt_slabs) — a loan is
-- specific to one employee within one tenant, not shared reference data.
CREATE TABLE IF NOT EXISTS "employee_loans" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "loan_type" varchar(30) NOT NULL,
  "principal_amount" numeric(15, 2) NOT NULL,
  "tenure_months" integer NOT NULL,
  "monthly_deduction" numeric(15, 2) NOT NULL,
  "disbursed_amount" numeric(15, 2) NOT NULL,
  "disbursed_date" date NOT NULL,
  "outstanding_balance" numeric(15, 2) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_employee_loans_active" ON "employee_loans" ("tenant_id", "employee_id", "status");

-- Per-payslip audit trail — answers "which loan(s) contributed to this month's loan
-- deduction" once an employee has more than one active loan (payroll_slips.loan_deduction
-- alone only has the aggregate).
CREATE TABLE IF NOT EXISTS "loan_deduction_history" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "employee_loan_id" integer NOT NULL,
  "payroll_slip_id" integer NOT NULL,
  "amount_deducted" numeric(15, 2) NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_loan_deduction_history_loan" ON "loan_deduction_history" ("employee_loan_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_loan_deduction_history_slip" ON "loan_deduction_history" ("payroll_slip_id", "tenant_id");
