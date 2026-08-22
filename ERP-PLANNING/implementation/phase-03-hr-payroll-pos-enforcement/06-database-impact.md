# 06 — Database Impact

## No schema change, in any D1 outcome

No table, column, index, or constraint changes under any of D1's options (a/b/c). This phase is authorization-boundary code plus, possibly, a data-only migration.

## Migration — conditional on D1

**If D1 resolves to (a) — backfill first, per the plan-derived approach `25-decision-record.md` D1 recommends:**

One data-only migration (numbered after the current highest, `0169`, at implementation time — verify the actual latest number then, do not hardcode `0170` here since other work may land first):

```sql
-- Set each tenant's flag to exactly what its own plan already entitles it to
-- (plan_entitlements.feature_flags is the source of truth), not a blanket true.
UPDATE feature_flags ff SET enabled = true
FROM tenants t, plan_entitlements pe
WHERE ff.tenant_id = t.id
  AND pe.plan = t.plan
  AND ff.flag_key = 'pos.enabled'
  AND pe.feature_flags @> '["pos.enabled"]'::jsonb;

UPDATE feature_flags ff SET enabled = true
FROM tenants t, plan_entitlements pe
WHERE ff.tenant_id = t.id
  AND pe.plan = t.plan
  AND ff.flag_key = 'hr.payroll.enabled'
  AND pe.feature_flags @> '["hr.payroll.enabled"]'::jsonb;

-- Tenant-1-shaped gap: a tenant entitled by plan but with NO existing feature_flags row
-- for the key at all (INSERT, not UPDATE, needed for this case) — verify exact row shape
-- (tenant_id, flag_key, enabled, + any other NOT NULL columns) against the real
-- feature_flags schema at implementation time before writing the final INSERT.
INSERT INTO feature_flags (tenant_id, flag_key, enabled)
SELECT t.id, 'pos.enabled', true
FROM tenants t
JOIN plan_entitlements pe ON pe.plan = t.plan
WHERE pe.feature_flags @> '["pos.enabled"]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM feature_flags ff WHERE ff.tenant_id = t.id AND ff.flag_key = 'pos.enabled');
-- + the equivalent INSERT for 'hr.payroll.enabled'
```

Idempotent by construction (`UPDATE ... SET enabled = true` and the `NOT EXISTS`-guarded `INSERT` are both safe to re-run). Matches the "verify by direct SQL application, not `drizzle-kit migrate`" workaround `39-implementation-report.md` §10/§19.5 already had to use in this environment (`db_migration_bookkeeping_broken`, a pre-existing, unrelated tooling gap). **Exact SQL above is illustrative** — verify `plan_entitlements.feature_flags`'s actual JSON shape/column type and `feature_flags`'s full NOT NULL column set fresh at implementation time, don't assume this session's `SELECT`-only queries captured every constraint.

**Rejected alternative**: a blanket `UPDATE ... SET enabled = true WHERE tenant_id IS NOT NULL` (no plan check) was this document's first draft, before the `plan_entitlements` query in `01-current-code-evidence.md` §5 revealed the plan-tier design — rejected because it would silently grant POS/Payroll to all 25 `STARTER` tenants in this dataset, none of whom are entitled to either under the existing (if unenforced) plan design.

**If D1 resolves to (b) — shadow mode:** no migration in this phase at all; the temporary log-only code path (itself flagged as a deviation in D1) replaces the need for a backfill, since nothing is actually enforced until the observation window confirms safety. A backfill (or targeted per-tenant flag flip) would still likely follow, informed by the shadow-mode data, but as an ops action, not necessarily a versioned migration.

**If D1 resolves to (c) — enforce immediately, no real tenants exist yet:** no migration needed; existing dev-tenant flags (2 and 13) are already correct for testing.

## Rollback

Any backfill migration is trivially reversible: `UPDATE feature_flags SET enabled = false WHERE flag_key IN (...) AND tenant_id IS NOT NULL AND <same predicate>` — but rollback of the _data_ is a distinct action from rollback of the _code_ (removing the `requireCapability` preHandler); see `19-rollout-and-rollback.md` for the full rollback sequencing, since rolling back the code without rolling back an unwanted `true` backfill leaves flags in a changed-but-harmless state (a capability is enabled with no enforcement — matches Phase 1's own "inert until wired" starting state, so this is a safe resting position, not a hazard).

## Not built

- No `plan_entitlements` change (`10-entitlement-impact.md` confirms no plan-tier interaction).
- No `TenantProvisioner.seedFeatureFlags` change — the provisioning-time default (`false`) is deliberately left alone; changing the _default_ for all future tenants is a separate, larger business decision (should new tenants get POS/Payroll on by default?) not implied by fixing _existing_ tenants' drift, and out of this phase's scope unless the user says otherwise when resolving D1.
