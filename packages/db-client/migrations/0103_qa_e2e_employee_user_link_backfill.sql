-- 2026-07-25: migration 0087 added employees.user_id for HR self-service ("My
-- Attendance/Leave/Payroll") but intentionally left it NULL — there's no reliable way to
-- auto-match arbitrary employee records to login users in general. This backfills it for the
-- QA E2E test tenant (tenant_id 2) only, pairing each named test-role user with a distinct
-- employee record so the self-service pages have real data to render during local/QA testing.
-- Scoped to exact tenant_id 2 + @qa-e2e.local emails, so it's a no-op against any real tenant.
WITH pairs(email, employee_id) AS (
  VALUES
    ('owner@qa-e2e.local', 2),
    ('admin@qa-e2e.local', 25),
    ('super.admin@qa-e2e.local', 7),
    ('sales.manager@qa-e2e.local', 3),
    ('cashier@qa-e2e.local', 4),
    ('purchase.manager@qa-e2e.local', 26),
    ('inventory.manager@qa-e2e.local', 6),
    ('accountant@qa-e2e.local', 5),
    ('accountant.supervisor@qa-e2e.local', 29),
    ('auditor@qa-e2e.local', 30),
    ('hr.manager@qa-e2e.local', 27),
    ('staff@qa-e2e.local', 1),
    ('data.officer@qa-e2e.local', 31)
)
UPDATE employees e
SET user_id = u.id
FROM pairs p
JOIN users u ON u.email = p.email AND u.tenant_id = 2
WHERE e.id = p.employee_id
  AND e.tenant_id = 2
  AND e.user_id IS NULL;
