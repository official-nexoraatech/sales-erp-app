-- Phase 8 — HR, Payroll, and Alteration Workflow Migration
-- M8.1: Employee Master (departments, designations, employees)
-- M8.2: Attendance Management (shifts, attendance)
-- M8.3: Leave Management (leave_types, employee_leave_balance, leave_applications)
-- M8.4: Payroll Processing (salary_structures, employee_salaries, payroll_runs, payroll_slips)
-- M8.5: Alteration Order Management (alteration_orders, alteration_tasks)
-- M8.6: Tailor Work Log (tailor_work_log)

-- ─── Departments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "departments" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "code" varchar(30) NOT NULL,
  "description" text,
  "manager_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "deleted_at" timestamptz,
  "deleted_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "departments_tenant_code" UNIQUE("tenant_id", "code")
);
CREATE INDEX IF NOT EXISTS "idx_departments_tenant" ON "departments" ("tenant_id", "is_active");

-- ─── Designations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "designations" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "code" varchar(30) NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "deleted_at" timestamptz,
  "deleted_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "designations_tenant_code" UNIQUE("tenant_id", "code")
);
CREATE INDEX IF NOT EXISTS "idx_designations_tenant" ON "designations" ("tenant_id", "is_active");

-- ─── Employees ──────────────────────────────────────────────────────────────
-- Sensitive: pan_encrypted, bank_account_no_encrypted (AES-256-GCM) + HMAC _hash companions
-- Aadhaar: last 4 digits only
CREATE TABLE IF NOT EXISTS "employees" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "employee_code" varchar(30) NOT NULL,
  "first_name" varchar(100) NOT NULL,
  "last_name" varchar(100) NOT NULL,
  "display_name" varchar(200) NOT NULL,
  "phone" varchar(20) NOT NULL,
  "email" varchar(200),
  "gender" varchar(10),
  "date_of_birth" date,
  "aadhaar_last4" varchar(4),
  "pan_encrypted" varchar(500),
  "pan_hash" varchar(64),
  "bank_account_no_encrypted" varchar(500),
  "bank_account_no_hash" varchar(64),
  "bank_name" varchar(200),
  "bank_ifsc" varchar(20),
  "employment_type" varchar(30) NOT NULL DEFAULT 'FULL_TIME',
  "department_id" integer,
  "designation_id" integer,
  "branch_id" integer,
  "manager_id" integer,
  "shift_id" integer,
  "joining_date" date NOT NULL,
  "exit_date" date,
  "exit_reason" text,
  "photo_url" varchar(500),
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "is_active" boolean NOT NULL DEFAULT true,
  "deleted_at" timestamptz,
  "deleted_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "employees_tenant_code" UNIQUE("tenant_id", "employee_code")
);
CREATE INDEX IF NOT EXISTS "idx_employees_tenant_status" ON "employees" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_employees_department" ON "employees" ("department_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_employees_pan_hash" ON "employees" ("pan_hash", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_employees_phone" ON "employees" ("phone", "tenant_id");

-- ─── Shifts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shifts" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "grace_period_minutes" integer NOT NULL DEFAULT 15,
  "half_day_hours" numeric(4, 2) NOT NULL DEFAULT '4',
  "standard_hours" numeric(4, 2) NOT NULL DEFAULT '8',
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "shifts_tenant_name" UNIQUE("tenant_id", "name")
);
CREATE INDEX IF NOT EXISTS "idx_shifts_tenant" ON "shifts" ("tenant_id", "is_active");

-- ─── Attendance ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "attendance" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "attendance_date" date NOT NULL,
  "check_in_time" timestamptz,
  "check_out_time" timestamptz,
  "source" varchar(20) NOT NULL DEFAULT 'MANUAL',
  "status" varchar(20) NOT NULL DEFAULT 'PRESENT',
  "work_hours" numeric(4, 2) NOT NULL DEFAULT '0',
  "overtime_hours" numeric(4, 2) NOT NULL DEFAULT '0',
  "shift_id" integer,
  "is_late" boolean NOT NULL DEFAULT false,
  "correction_reason" text,
  "corrected_by" integer,
  "corrected_at" timestamptz,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_employee_date" UNIQUE("tenant_id", "employee_id", "attendance_date")
);
CREATE INDEX IF NOT EXISTS "idx_attendance_employee_date" ON "attendance" ("employee_id", "attendance_date", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_attendance_tenant_date" ON "attendance" ("tenant_id", "attendance_date");

-- ─── Leave Types ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "code" varchar(20) NOT NULL,
  "days_per_year" numeric(6, 2) NOT NULL DEFAULT '0',
  "can_carry_forward" boolean NOT NULL DEFAULT false,
  "max_carry_forward_days" numeric(6, 2) NOT NULL DEFAULT '0',
  "is_gender_specific" boolean NOT NULL DEFAULT false,
  "gender_allowed" varchar(10),
  "min_service_months" integer NOT NULL DEFAULT 0,
  "requires_document" boolean NOT NULL DEFAULT false,
  "document_required_after_days" integer NOT NULL DEFAULT 0,
  "expiry_days" integer NOT NULL DEFAULT 0,
  "is_paid_leave" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "leave_types_tenant_code" UNIQUE("tenant_id", "code")
);
CREATE INDEX IF NOT EXISTS "idx_leave_types_tenant" ON "leave_types" ("tenant_id", "is_active");

-- ─── Employee Leave Balance ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "employee_leave_balance" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "leave_type_id" integer NOT NULL,
  "year" integer NOT NULL,
  "total_days" numeric(6, 2) NOT NULL DEFAULT '0',
  "used_days" numeric(6, 2) NOT NULL DEFAULT '0',
  "pending_days" numeric(6, 2) NOT NULL DEFAULT '0',
  "carried_forward_days" numeric(6, 2) NOT NULL DEFAULT '0',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_balance_unique" UNIQUE("tenant_id", "employee_id", "leave_type_id", "year")
);
CREATE INDEX IF NOT EXISTS "idx_leave_balance_employee" ON "employee_leave_balance" ("employee_id", "tenant_id", "year");

-- ─── Leave Applications ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "leave_applications" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "leave_type_id" integer NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "days" numeric(4, 1) NOT NULL,
  "reason" text,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "approved_by" integer,
  "approved_at" timestamptz,
  "rejected_by" integer,
  "rejected_at" timestamptz,
  "rejection_reason" text,
  "cancelled_by" integer,
  "cancelled_at" timestamptz,
  "document_url" varchar(500),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_leave_app_employee" ON "leave_applications" ("employee_id", "tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_leave_app_tenant_status" ON "leave_applications" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_leave_app_dates" ON "leave_applications" ("start_date", "end_date", "tenant_id");

-- ─── Salary Structures ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "salary_structures" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "code" varchar(30) NOT NULL,
  "basic_percent" numeric(5, 2) NOT NULL DEFAULT '50',
  "hra_percent" numeric(5, 2) NOT NULL DEFAULT '20',
  "da_percent" numeric(5, 2) NOT NULL DEFAULT '10',
  "allowances" jsonb DEFAULT '[]',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "salary_structures_tenant_code" UNIQUE("tenant_id", "code")
);
CREATE INDEX IF NOT EXISTS "idx_salary_structures_tenant" ON "salary_structures" ("tenant_id", "is_active");

-- ─── Employee Salaries (encrypted — never cached, never logged, never in list APIs) ──
CREATE TABLE IF NOT EXISTS "employee_salaries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "salary_structure_id" integer,
  "ctc_encrypted" varchar(500) NOT NULL,
  "basic_encrypted" varchar(500) NOT NULL,
  "hra_encrypted" varchar(500),
  "da_encrypted" varchar(500),
  "allowances_encrypted" varchar(2000),
  "gross_encrypted" varchar(500) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_emp_salaries_employee" ON "employee_salaries" ("employee_id", "tenant_id", "is_active");

-- ─── Payroll Runs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "working_days" integer NOT NULL DEFAULT 26,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "total_employees" integer NOT NULL DEFAULT 0,
  "total_gross" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_deductions" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_net" numeric(15, 2) NOT NULL DEFAULT '0',
  "salary_journal_id" varchar(26),
  "disbursal_journal_id" varchar(26),
  "approved_by" integer,
  "approved_at" timestamptz,
  "disbursed_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_runs_tenant_period" UNIQUE("tenant_id", "period_month", "period_year")
);
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_tenant" ON "payroll_runs" ("tenant_id", "status", "period_year");

-- ─── Payroll Slips ──────────────────────────────────────────────────────────
-- Net salary figures stored — NEVER cached in Redis, NEVER logged
CREATE TABLE IF NOT EXISTS "payroll_slips" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "payroll_run_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "present_days" numeric(4, 1) NOT NULL DEFAULT '0',
  "paid_leave_days" numeric(4, 1) NOT NULL DEFAULT '0',
  "lop_days" numeric(4, 1) NOT NULL DEFAULT '0',
  "working_days" integer NOT NULL DEFAULT 26,
  "basic_salary" numeric(15, 2) NOT NULL DEFAULT '0',
  "hra_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "da_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "other_allowances" numeric(15, 2) NOT NULL DEFAULT '0',
  "piece_rate_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "gross_salary" numeric(15, 2) NOT NULL DEFAULT '0',
  "pf_employee" numeric(15, 2) NOT NULL DEFAULT '0',
  "pf_employer" numeric(15, 2) NOT NULL DEFAULT '0',
  "esi_employee" numeric(15, 2) NOT NULL DEFAULT '0',
  "esi_employer" numeric(15, 2) NOT NULL DEFAULT '0',
  "professional_tax" numeric(15, 2) NOT NULL DEFAULT '0',
  "loan_deduction" numeric(15, 2) NOT NULL DEFAULT '0',
  "tds_deduction" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_deductions" numeric(15, 2) NOT NULL DEFAULT '0',
  "net_salary" numeric(15, 2) NOT NULL DEFAULT '0',
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "slip_sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_slips_run_employee" UNIQUE("tenant_id", "payroll_run_id", "employee_id")
);
CREATE INDEX IF NOT EXISTS "idx_payroll_slips_run" ON "payroll_slips" ("payroll_run_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_slips_employee" ON "payroll_slips" ("employee_id", "tenant_id");

-- ─── Alteration Orders ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "alteration_orders" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "order_number" varchar(30) NOT NULL,
  "branch_id" integer,
  "customer_id" integer,
  "customer_name" varchar(200) NOT NULL,
  "customer_phone" varchar(20) NOT NULL,
  "received_date" date NOT NULL,
  "promised_date" date NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]',
  "total_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "advance_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "balance_due" numeric(15, 2) NOT NULL DEFAULT '0',
  "assigned_to_id" integer,
  "status" varchar(30) NOT NULL DEFAULT 'RECEIVED',
  "notes" text,
  "delivered_at" timestamptz,
  "delivery_payment_received" numeric(15, 2) NOT NULL DEFAULT '0',
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "ready_notified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "alteration_orders_tenant_number" UNIQUE("tenant_id", "order_number")
);
CREATE INDEX IF NOT EXISTS "idx_alteration_orders_tenant_status" ON "alteration_orders" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_alteration_orders_assigned" ON "alteration_orders" ("assigned_to_id", "tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_alteration_orders_promised" ON "alteration_orders" ("promised_date", "status", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_alteration_orders_customer_phone" ON "alteration_orders" ("customer_phone", "tenant_id");

-- ─── Alteration Tasks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "alteration_tasks" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "alteration_order_id" integer NOT NULL,
  "task_description" text NOT NULL,
  "tailor_id" integer,
  "assigned_at" timestamptz,
  "completed_at" timestamptz,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_alteration_tasks_order" ON "alteration_tasks" ("alteration_order_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_alteration_tasks_tailor" ON "alteration_tasks" ("tailor_id", "tenant_id", "status");

-- ─── Tailor Work Log (piece-rate, feature-flagged: hr.tailoring.enabled) ────
CREATE TABLE IF NOT EXISTS "tailor_work_log" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "alteration_order_id" integer,
  "work_date" date NOT NULL,
  "task_description" text NOT NULL,
  "units" numeric(8, 2) NOT NULL DEFAULT '1',
  "rate_per_unit" numeric(10, 2) NOT NULL DEFAULT '0',
  "amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_tailor_work_log_employee" ON "tailor_work_log" ("employee_id", "tenant_id", "work_date");
CREATE INDEX IF NOT EXISTS "idx_tailor_work_log_order" ON "tailor_work_log" ("alteration_order_id", "tenant_id");
