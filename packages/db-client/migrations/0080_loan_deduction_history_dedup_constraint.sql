-- Defense-in-depth alongside the atomic guarded status transition added to payroll.routes.ts'
-- POST /payroll-runs/:id/approve handler: two concurrent approve calls on the same run used
-- to both pass a plain get()-then-update() status check and both loop
-- EmployeeLoanService.applyMonthlyDeduction() over every slip, double-decrementing each
-- employee's loan outstandingBalance and inserting two loan_deduction_history rows for one
-- physical approval. The route-level fix closes the reachable race; this constraint rejects
-- a duplicate (employee_loan_id, payroll_slip_id) pair at the DB level too, in case any other
-- code path ever calls applyMonthlyDeduction() twice for the same slip.

ALTER TABLE loan_deduction_history
  ADD CONSTRAINT loan_deduction_history_loan_slip UNIQUE (employee_loan_id, payroll_slip_id);
