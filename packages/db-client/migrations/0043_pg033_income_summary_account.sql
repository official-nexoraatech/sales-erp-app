-- PG-033: backfill a real per-tenant "Income Summary" system account (code 3900)
-- for tenants provisioned before this account was added to DEFAULT_ACCOUNTS.
-- created_by uses each tenant's earliest user as a placeholder audit value —
-- this is a system-seeded account, not something an actual user created.
INSERT INTO "accounts" (
  "tenant_id", "parent_id", "account_code", "name", "account_type", "account_sub_type",
  "normal_balance", "is_system", "opening_balance", "created_by"
)
SELECT
  t.tenant_id,
  parent."id",
  '3900',
  'Income Summary',
  'EQUITY',
  'INCOME_SUMMARY',
  'CREDIT',
  true,
  '0',
  t.first_user_id
FROM (
  SELECT tenant_id, MIN(id) AS first_user_id
  FROM "users"
  GROUP BY tenant_id
) t
LEFT JOIN "accounts" parent
  ON parent.tenant_id = t.tenant_id AND parent.account_code = '3000'
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a
  WHERE a.tenant_id = t.tenant_id AND a.account_sub_type = 'INCOME_SUMMARY'
)
ON CONFLICT ON CONSTRAINT accounts_tenant_code DO NOTHING;
