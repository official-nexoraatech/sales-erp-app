-- Business Rules Engine, Commission category: accounts 6120 (Sales Commission Expense) and
-- 2350 (Commission Payable) were added to DEFAULT_ACCOUNTS after existing tenants had already
-- run POST /accounts/seed, so their Chart of Accounts is missing them — same bug class as
-- migration 0071 (PG-045, Employee Loans Receivable). CommissionService.approve()'s
-- COMMISSION_APPROVED journal fails with JOURNAL_INSUFFICIENT_LINES for every existing tenant
-- until these accounts exist (confirmed via live end-to-end testing: a real commission
-- approval failed in accounting-service with exactly this error). New tenants get both
-- automatically via DEFAULT_ACCOUNTS at provisioning time.
INSERT INTO "accounts" (
  "tenant_id", "parent_id", "account_code", "name", "account_type", "account_sub_type",
  "normal_balance", "is_bank", "is_cash", "is_system", "opening_balance", "created_by"
)
SELECT
  parent."tenant_id", parent."id", '6120', 'Sales Commission Expense', 'EXPENSE',
  'OPERATING_EXPENSE', 'DEBIT', false, false, false, '0', 0
FROM "accounts" parent
WHERE parent."account_code" = '6000'
ON CONFLICT ("tenant_id", "account_code") DO NOTHING;

INSERT INTO "accounts" (
  "tenant_id", "parent_id", "account_code", "name", "account_type", "account_sub_type",
  "normal_balance", "is_bank", "is_cash", "is_system", "opening_balance", "created_by"
)
SELECT
  parent."tenant_id", parent."id", '2350', 'Commission Payable', 'LIABILITY',
  'OTHER_CURRENT_LIABILITY', 'CREDIT', false, false, false, '0', 0
FROM "accounts" parent
WHERE parent."account_code" = '2300'
ON CONFLICT ("tenant_id", "account_code") DO NOTHING;
