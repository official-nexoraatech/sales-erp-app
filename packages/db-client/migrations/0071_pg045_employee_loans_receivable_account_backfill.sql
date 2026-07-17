-- PG-045: account 1340 (Employee Loans Receivable) was added to DEFAULT_ACCOUNTS after many
-- tenants had already run POST /accounts/seed, so their Chart of Accounts is missing it.
-- EMPLOYEE_LOAN_DISBURSED postings fail with JOURNAL_INSUFFICIENT_LINES for these tenants
-- until the account exists. New tenants get it automatically via DEFAULT_ACCOUNTS.
INSERT INTO "accounts" (
  "tenant_id", "parent_id", "account_code", "name", "account_type", "account_sub_type",
  "normal_balance", "is_bank", "is_cash", "is_system", "opening_balance", "created_by"
)
SELECT
  parent."tenant_id", parent."id", '1340', 'Employee Loans Receivable', 'ASSET',
  'OTHER_CURRENT_ASSET', 'DEBIT', false, false, false, '0', 0
FROM "accounts" parent
WHERE parent."account_code" = '1300'
ON CONFLICT ("tenant_id", "account_code") DO NOTHING;
