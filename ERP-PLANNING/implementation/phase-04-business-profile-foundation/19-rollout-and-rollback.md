# 19 — Rollout and Rollback

## Sequencing

```
Step 1 — Apply the migration (06-database-impact.md): tables, seed data, column, backfill.
Step 2 — Verify by direct SQL: every tenant's business_type_id resolves to a business_types
          row whose code matches that tenant's own vertical value.
Step 3 — Deploy the code change (setTenantBusinessType(), TenantProvisioner.ts's call site).
Step 4 — Confirm a new tenant provisioned post-deploy gets both fields set correctly
          (16-testing-strategy.md's integration test, run for real once, not just in CI).
```

No observation window, no shadow mode, no gradual rollout needed — unlike Phase 3, there is no tenant-facing behavior to observe for regressions, because none changes (`17-migration-and-backward-compatibility.md`'s "zero behavior change, without exception" claim). Migration and code can deploy together; there is no safety reason to separate them the way Phase 3's D1 required.

## Rollback triggers

Essentially none expected — if the backfill's correctness-verification query (Step 2) ever shows a mismatch, that indicates a bug in the migration SQL itself (e.g., a `business_types.code` value typo), not a data-safety incident — fix the migration, don't roll back and re-plan.

## Rollback procedure

`17-migration-and-backward-compatibility.md`'s "Rollback" section — full, clean `DROP`, zero cleanup required.
