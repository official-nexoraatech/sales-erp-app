-- Backfill for existing tenants: two more role-defaults.ts-omission RBAC gaps found in a
-- route-by-route audit of accounting-service (same bug class as migrations 0075/0076 — a
-- route checks a permission constant that role-defaults.ts never granted to a role that
-- should logically have it).
--
-- 1. ACCOUNTANT_SUPERVISOR had ZERO fixed-asset permissions even though the junior
--    ACCOUNTANT role already holds all four (FIXED_ASSET_VIEW/CREATE/UPDATE/DISPOSE) — a
--    supervisor could not even view assets an accountant registered.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES ('FIXED_ASSET_VIEW'), ('FIXED_ASSET_CREATE'), ('FIXED_ASSET_UPDATE'), ('FIXED_ASSET_DISPOSE')
) AS p(permission)
WHERE r.name = 'ACCOUNTANT_SUPERVISOR'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 2. ACCOUNTANT_SUPERVISOR held BALANCE_SHEET_VIEW/PROFIT_LOSS_VIEW/TRIAL_BALANCE_VIEW but
--    not CASH_FLOW_VIEW — accounting-service's GET /reports/cash-flow was unreachable,
--    despite this role owning every other core financial report. (ACCOUNTANT itself holds
--    none of the four report-view permissions — that split is intentional, so it is not
--    included here.)
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CASH_FLOW_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name = 'ACCOUNTANT_SUPERVISOR'
ON CONFLICT ("role_id", "permission") DO NOTHING;
