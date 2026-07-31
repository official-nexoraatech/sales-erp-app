-- 2026-07-20 HR audit: no employee self-service concept existed at all — an authenticated
-- user could only ever see attendance/leave/payslip data if they held the broad manager-level
-- VIEW permission (which grants access to EVERY employee's data, not just their own). This adds
-- a nullable link from an employee record to the login user who IS that employee, so
-- hr-service's new "/me/..." self-service routes can resolve "the caller's own employee record"
-- with a local lookup — no auth-service/JWT/users-table change needed.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "user_id" integer;
CREATE INDEX IF NOT EXISTS "idx_employees_user" ON "employees" ("user_id", "tenant_id");
