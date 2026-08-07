-- Fixes 2 of the 6 seeded system business_rules whose conditions could never match: they
-- compared one data field against another (e.g. "customer.outstandingAmount >=
-- customer.creditLimit") by putting a field-path string in condition.value, but
-- RuleEngine.evaluateCondition() only ever compares a field against condition.value's
-- *literal* value — Number('customer.creditLimit') is NaN, so the comparison could never be
-- true. Callers now pre-compute the comparison themselves (isOverCreditLimit /
-- isAtOrBelowReorderLevel) and pass it in as its own boolean field (see
-- packages/platform-sdk/src/rule-engine.ts's SYSTEM_RULE_TEMPLATES for the corrected shape,
-- and InvoiceService.createInTransaction for the first real call site). This backfills
-- already-seeded system rows for existing tenants; role-defaults-style seeding only runs at
-- tenant-provisioning time.
UPDATE "business_rules"
SET "conditions" = '[{"field":"isOverCreditLimit","operator":"EQUALS","value":true}]'::jsonb,
    "updated_at" = now()
WHERE "is_system" = true
  AND "name" = 'Block sale above credit limit'
  AND "conditions" = '[{"field":"customer.creditLimitEnabled","operator":"EQUALS","value":true},{"field":"customer.outstandingAmount","operator":"GREATER_THAN_EQUALS","value":"customer.creditLimit"}]'::jsonb;

UPDATE "business_rules"
SET "conditions" = '[{"field":"isAtOrBelowReorderLevel","operator":"EQUALS","value":true}]'::jsonb,
    "updated_at" = now()
WHERE "is_system" = true
  AND "name" = 'Reorder alert at reorder level'
  AND "conditions" = '[{"field":"resultingQuantity","operator":"LESS_THAN_EQUALS","value":"item.reorderLevel"}]'::jsonb;
