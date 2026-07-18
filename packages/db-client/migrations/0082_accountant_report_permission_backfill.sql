-- Backfill for existing tenants: role-defaults.ts-omission RBAC gaps in the ACCOUNTANT role,
-- found and confirmed still-current via apps/docs-site's own accounting architecture audit
-- pages (cross-checked against the live route files before fixing — several other claims on
-- those same pages turned out to already be fixed by earlier sessions).
--
-- ACCOUNTANT could create an account but never edit or delete one afterward
-- (accounts.routes.ts gates both PUT/DELETE /accounts/:id on ACCOUNT_UPDATE), and could not
-- view any of the four core financial reports or the Bank Book report despite being the
-- role that enters the underlying journal/account/reconciliation data.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES
    ('ACCOUNT_UPDATE'),
    ('BALANCE_SHEET_VIEW'),
    ('PROFIT_LOSS_VIEW'),
    ('TRIAL_BALANCE_VIEW'),
    ('CASH_FLOW_VIEW'),
    ('BANK_RECONCILIATION_VIEW')
) AS p(permission)
WHERE r.name = 'ACCOUNTANT'
ON CONFLICT ("role_id", "permission") DO NOTHING;
