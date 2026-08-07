-- Business Rules Engine wiring: backfill RULE_VIEW/RULE_SIMULATE for existing SALES_MANAGER
-- and PURCHASE_MANAGER roles.
--
-- Root cause: apps/platform-sdk/src/rule-engine.ts's RuleEngine (evaluate/simulate/seedTemplates)
-- and the business_rules table have existed since an earlier phase with a full CRUD+simulate API
-- (apps/auth-service/src/routes/rules.ts), but RULE_VIEW/CREATE/UPDATE/DELETE/SIMULATE were never
-- granted to any named role in role-defaults.ts — only reachable via OWNER/ADMIN/SUPER_ADMIN's
-- TENANT_SCOPED_PERMISSIONS wildcard. Now that RuleEngine.evaluate() is actually wired into
-- InvoiceService (credit-limit/discount) and PurchaseOrderService (approval threshold/GRN-PO
-- match), SALES_MANAGER and PURCHASE_MANAGER need read+simulate visibility into the rules
-- governing their own domain, same "config vs execution" split as this codebase's established
-- role-defaults.ts convention (CRUD stays OWNER/ADMIN/SUPER_ADMIN-only). role-defaults.ts is only
-- applied at tenant-provisioning time, so this backfills tenants that already exist.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'RULE_VIEW', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'PURCHASE_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'RULE_SIMULATE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('SALES_MANAGER', 'PURCHASE_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
