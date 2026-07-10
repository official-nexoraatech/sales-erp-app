-- PG-015: event-service's DLQ/Saga/Schema-Registry/Projections/Event-Store/Performance
-- admin-console routes stopped checking the broad AUDIT_LOG_VIEW catch-all and now check
-- their own console-specific permission constants (DLQ_VIEW/DLQ_MANAGE, SAGA_VIEW/
-- SAGA_MANAGE, SCHEMA_REGISTRY_VIEW/SCHEMA_REGISTRY_MANAGE, PROJECTION_VIEW/
-- PROJECTION_MANAGE, EVENT_STORE_VIEW, PERFORMANCE_VIEW — the last one new in this
-- change). role-defaults.ts is only applied at tenant-provisioning time, so this backfills
-- tenants that already exist.
--
-- Part 1: OWNER/ADMIN/SUPER_ADMIN get every permission via role-defaults.ts's
-- TENANT_SCOPED_PERMISSIONS wildcard spread, but that wildcard is only evaluated against
-- whatever constants existed in packages/shared-types/src/permissions.ts at the time each
-- tenant was provisioned. The DLQ/Saga/Schema-Registry/Projection/Event-Store constants
-- were added in an earlier Phase 12 pass with no accompanying backfill migration, so any
-- tenant provisioned before that pass (or before this one, for PERFORMANCE_VIEW) is
-- missing them from role_permissions even though the wildcard implies they should have
-- them. Backfilling here closes that gap for these roles specifically.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('EVENT_STORE_VIEW'),
  ('DLQ_VIEW'), ('DLQ_MANAGE'),
  ('SAGA_VIEW'), ('SAGA_MANAGE'),
  ('SCHEMA_REGISTRY_VIEW'), ('SCHEMA_REGISTRY_MANAGE'),
  ('PROJECTION_VIEW'), ('PROJECTION_MANAGE'),
  ('PERFORMANCE_VIEW')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- Part 2: ACCOUNTANT/ACCOUNTANT_SUPERVISOR/AUDITOR held AUDIT_LOG_VIEW and could
-- previously call every one of these routes (including the mutating ones) via that
-- catch-all, even though they had no nav entry for these consoles. Rather than carry
-- that mutate access forward, grant these three roles read-only visibility only — no
-- *_MANAGE constants — so they can't trigger DLQ replay, Saga compensate, schema
-- changes, or projection rebuilds. This narrows their effective access, which is the
-- intended outcome of this fix, not a regression.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES
  ('DLQ_VIEW'),
  ('SAGA_VIEW'),
  ('SCHEMA_REGISTRY_VIEW'),
  ('PROJECTION_VIEW'),
  ('EVENT_STORE_VIEW'),
  ('PERFORMANCE_VIEW')
) AS p(permission)
WHERE r.name IN ('ACCOUNTANT', 'ACCOUNTANT_SUPERVISOR', 'AUDITOR')
ON CONFLICT ("role_id", "permission") DO NOTHING;
