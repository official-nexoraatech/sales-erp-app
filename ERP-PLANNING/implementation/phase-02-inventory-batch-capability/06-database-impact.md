# 06 — Database Impact

## 1. One new migration, additive-only

No table/column DDL (schema already complete, `04-domain-model.md` §1). The one new migration needed is a **data** migration: seed the new global flag default and backfill existing tenant roles with the two new permissions. Next sequential migration number to verify immediately before authoring (per `17-risk-register.md` R7's precedent and `concurrent_sessions_on_same_repo` — highest existing is `0168_pos_day_end_settlements.sql` as of this planning session; re-check at implementation time).

```sql
-- 0169_inventory_batch_capability.sql (name/number indicative — verify at implementation time)

-- 1. Global default for the new capability's backing flag.
--    Default TRUE: preserves current de facto behavior (batch/expiry data has always been
--    captured unconditionally by GRNService whenever provided — see 01-current-code-evidence.md
--    §2) and lets nearExpiryAlert.job.ts's already-working alerting keep working unchanged for
--    every tenant. Setting the ITEM-level fefoEnabled toggle still requires explicit admin
--    action per item (06-database-impact.md does not touch item rows) — so no existing item's
--    consumption behavior changes even though the capability itself is "on" everywhere.
INSERT INTO "feature_flags" ("tenant_id", "flag_key", "enabled")
SELECT NULL, 'inventory.batch.enabled', true
WHERE NOT EXISTS (
  SELECT 1 FROM "feature_flags" WHERE "tenant_id" IS NULL AND "flag_key" = 'inventory.batch.enabled'
);

-- 2. Permission backfill for existing tenants' roles — see 08-permissions-and-rbac.md for the
--    full "dead permission constant" rationale. ROLE_DEFAULTS (tenant-service, code) only
--    applies at NEW-tenant provisioning; existing tenants' role→permission rows must be updated
--    directly, or INVENTORY_MANAGER/OWNER/ADMIN users on existing tenants will hold a role that
--    grants BATCH_VIEW/BATCH_CONFIGURE in code but not in their actual stored permission set.
--    Exact table/columns to be confirmed against apps/auth-service/src/domain/roles.ts's real
--    schema at implementation time — this is the one item in this phase requiring that lookup
--    (not done in this planning pass, since it risks drifting from the real schema by the time
--    implementation starts — same caution 00-roadmap-analysis.md applied to other detail).
```

## 2. Why default `true` globally, not `false`

This is the one place this phase deviates from "ship inert, default off" (Phase 1's own precedent — both `HR_PAYROLL`/`POS` defaulted per-tenant, not globally true). Justification: the _capability_ gates whether an item **can be configured** as batch-tracked and whether consumption honors it — it does not itself turn on any new behavior for any existing item (no existing item has `fefoEnabled = true`, confirmed impossible today, `01-current-code-evidence.md` §3). Defaulting the capability itself to `false` would mean **no tenant, including Grocery tenants who already receive batch/expiry data on every GRN today, could opt any item in without a separate admin/ops flag toggle** — an unnecessary extra step for a capability whose actual per-item effect is already opt-in by construction. Default `true` is the correct, evidence-based choice given the flag's actual gating surface, not a blanket "ship enabled" shortcut.

## 3. Rollback

Deleting the migration (dev-phase, no real data, per `project_dev_phase_no_data` memory) or, in a future prod context, `DELETE FROM feature_flags WHERE flag_key = 'inventory.batch.enabled'` + revert the permission backfill — safe, since no item's `fefoEnabled` can be `true` without this phase's other changes also being live (the toggle route doesn't exist without them).

## 4. What this migration does NOT do

- Does not touch `items`, `inventory_fifo_layers`, or any other table's rows.
- Does not add a CHECK constraint or new index (the FEFO-order index already exists from `0165`).
- Does not touch `business_types`/`industries` (don't exist).
