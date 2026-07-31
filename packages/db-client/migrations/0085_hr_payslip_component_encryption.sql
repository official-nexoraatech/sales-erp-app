-- 2026-07-20 HR module audit (G5): payroll_slips.grossSalary/netSalary were AES-256-GCM
-- encrypted since ES-06 (migration 0010), but every component that sums to them
-- (basic/HRA/DA/other allowances/piece-rate) and every deduction (PF/EPS/ESI/PT/loan/TDS/
-- total deductions) remained plain decimal in the same row — reconstructible by simply
-- summing the plaintext columns, defeating the point of encrypting gross/net at all.
--
-- This converts those 13 columns to text so the application can store AES-256-GCM
-- ciphertext in them, matching gross_salary/net_salary. Existing plaintext values are cast
-- to text as-is by this migration (still plaintext numbers after this step) — a separate
-- data migration script (tools/scripts/migrate-payslip-component-encryption.ts) then
-- encrypts them in place, same two-step pattern as the original ES-06 migration.
ALTER TABLE "payroll_slips"
  ALTER COLUMN "basic_salary" TYPE text USING "basic_salary"::text,
  ALTER COLUMN "basic_salary" SET DEFAULT '',
  ALTER COLUMN "hra_amount" TYPE text USING "hra_amount"::text,
  ALTER COLUMN "hra_amount" SET DEFAULT '',
  ALTER COLUMN "da_amount" TYPE text USING "da_amount"::text,
  ALTER COLUMN "da_amount" SET DEFAULT '',
  ALTER COLUMN "other_allowances" TYPE text USING "other_allowances"::text,
  ALTER COLUMN "other_allowances" SET DEFAULT '',
  ALTER COLUMN "piece_rate_amount" TYPE text USING "piece_rate_amount"::text,
  ALTER COLUMN "piece_rate_amount" SET DEFAULT '',
  ALTER COLUMN "pf_employee" TYPE text USING "pf_employee"::text,
  ALTER COLUMN "pf_employee" SET DEFAULT '',
  ALTER COLUMN "pf_employer" TYPE text USING "pf_employer"::text,
  ALTER COLUMN "pf_employer" SET DEFAULT '',
  ALTER COLUMN "eps_amount" TYPE text USING "eps_amount"::text,
  ALTER COLUMN "eps_amount" SET DEFAULT '',
  ALTER COLUMN "esi_employee" TYPE text USING "esi_employee"::text,
  ALTER COLUMN "esi_employee" SET DEFAULT '',
  ALTER COLUMN "esi_employer" TYPE text USING "esi_employer"::text,
  ALTER COLUMN "esi_employer" SET DEFAULT '',
  ALTER COLUMN "professional_tax" TYPE text USING "professional_tax"::text,
  ALTER COLUMN "professional_tax" SET DEFAULT '',
  ALTER COLUMN "loan_deduction" TYPE text USING "loan_deduction"::text,
  ALTER COLUMN "loan_deduction" SET DEFAULT '',
  ALTER COLUMN "tds_deduction" TYPE text USING "tds_deduction"::text,
  ALTER COLUMN "tds_deduction" SET DEFAULT '',
  ALTER COLUMN "total_deductions" TYPE text USING "total_deductions"::text,
  ALTER COLUMN "total_deductions" SET DEFAULT '';
