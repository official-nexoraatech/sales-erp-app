-- Backfill for existing tenants: role-defaults.ts-omission RBAC bugs found in the 2026-07-20
-- HR module comprehensive audit, same bug class as migration 0076
-- (role-defaults.ts only applies at tenant-provisioning time, so tenants provisioned before
-- this fix need these grants inserted directly).
--
-- 1. HR_MANAGER was missing 6 constants its own routes require: could create/edit but never
--    delete a department/designation (EMPLOYEE_DELETE); could mark but never correct a wrong
--    attendance entry (ATTENDANCE_CORRECT); could only ever approve, never reject, a leave
--    application (LEAVE_REJECT); could create/calculate but never approve, disburse, or bulk-send
--    the payroll run it just processed (PAYROLL_APPROVE); could view but never print/download a
--    payslip PDF (SALARY_SLIP_PRINT); and despite the role name, could not view/create/delete/
--    seed the Holiday Calendar at all (HR_MANAGE).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES ('EMPLOYEE_DELETE'), ('ATTENDANCE_CORRECT'), ('LEAVE_REJECT'),
         ('PAYROLL_APPROVE'), ('SALARY_SLIP_PRINT'), ('HR_MANAGE')
) AS p(permission)
WHERE r.name = 'HR_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 2. LEAVE_APPLY (POST /leave-applications, POST /leave-applications/:id/cancel) was granted
--    to nobody but OWNER/ADMIN/SUPER_ADMIN — no operational role, including HR_MANAGER and the
--    general-purpose STAFF role, could actually submit or cancel a leave application.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'LEAVE_APPLY', r.tenant_id
FROM "roles" r
WHERE r.name IN ('HR_MANAGER', 'STAFF')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 3. SALARY_VIEW was a dead permission constant — granted to HR_MANAGER but never checked by
--    any route guard anywhere (superseded by VIEW_SALARY_DETAILS). Removed from the constant
--    definitions and role defaults; harmless to leave any existing granted rows in place (an
--    unused grant, not a security issue), so no revoke statement is included here.
