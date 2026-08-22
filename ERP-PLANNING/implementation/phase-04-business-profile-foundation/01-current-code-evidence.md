# 01 — Current Code Evidence

## 1. Current `tenants.vertical` — confirmed live shape

```sql
-- packages/db-client/migrations/0164_tenants_vertical.sql
ALTER TABLE "tenants" ADD COLUMN "vertical" varchar(20) DEFAULT 'CLOTH_RETAIL' NOT NULL;
```

`packages/db-client/src/schema/tenant.ts:36` — Drizzle column definition, `varchar('vertical', { length: 20 })`, confirmed present, matches the migration. `apps/tenant-service/src/rbac/vertical-defaults.ts:1` — `export type TenantVertical = 'CLOTH_RETAIL' | 'GROCERY';`, a hardcoded 2-value TS union, exactly `02-gap-analysis.md` G2's cited problem, re-confirmed unchanged.

## 2. Real call sites — more than the architecture docs' "4 known" count

The architecture layer (`00-vision.md` §3, `02-gap-analysis.md` G2, `15-migration-strategy.md` step 2) cites "4 known call sites": `TenantProvisioner`, `default-accounts.ts`, `vertical-defaults.ts`, `scheduler-internal.routes.ts`. Re-grepping this session found a 5th, and a 6th worth distinguishing:

| #   | File:Line                                                              | What it does with `vertical`                                                                                                                                                                    | Counted in the "4 known" docs?                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/tenant-service/src/domain/TenantProvisioner.ts:78`               | `const vertical: TenantVertical = input.vertical ?? 'CLOTH_RETAIL';` — decides provisioning template                                                                                            | Yes                                                                                                                                                                                                                                                                                                                   |
| 2   | `apps/tenant-service/src/rbac/vertical-defaults.ts:1,17`               | Defines `TenantVertical` type and `VERTICAL_DEFAULTS` keyed by it                                                                                                                               | Yes                                                                                                                                                                                                                                                                                                                   |
| 3   | `apps/accounting-service/src/domain/default-accounts.ts:716,718`       | `vertical: 'CLOTH_RETAIL' \| 'GROCERY' = 'CLOTH_RETAIL'` param, selects chart-of-accounts seed list                                                                                             | Yes                                                                                                                                                                                                                                                                                                                   |
| 4   | `apps/accounting-service/src/api/scheduler-internal.routes.ts:186,194` | Reads `vertical` from a query param, defaults to `CLOTH_RETAIL` if not exactly `'GROCERY'`                                                                                                      | Yes                                                                                                                                                                                                                                                                                                                   |
| 5   | `apps/tenant-service/src/api/tenant.schemas.ts:13`                     | `vertical: z.enum(['CLOTH_RETAIL', 'GROCERY']).optional().default('CLOTH_RETAIL')` — the actual input-validation boundary; every other call site downstream of this is constrained by this enum | **Not previously named** — this is the real "hardcoded 2-value union" boundary G2 describes; the TS union in `vertical-defaults.ts` is its type-level twin, but this Zod schema is the runtime gate a new business type must pass through first                                                                       |
| 6   | `apps/tenant-service/src/api/tenant.routes.ts:154`                     | Echoes `body.data.vertical` into a `TENANT_CREATED` audit-log payload                                                                                                                           | Write-adjacent only — does not branch on the value, just records it; not a functional decision point, does not need to change for this phase to succeed, but will naturally carry `business_type_id`/code alongside `vertical` once `setTenantBusinessType()` exists, for audit completeness (`05-service-impact.md`) |

**Correction recorded, not silently absorbed**: the "4 known call sites" claim in the architecture layer is stale by one genuine functional call site (`tenant.schemas.ts`'s Zod enum) — this phase's file-level plan (`21-file-level-change-plan.md`) must include it, since widening this enum (or replacing it with a business-type lookup) is the actual mechanism a future Phase 10 uses to accept a new business type at the API boundary, not merely a TS-union relaxation.

## 3. `industries`/`business_types` — confirmed not to exist yet

```
grep -rln "business_types\|CREATE TABLE industries" packages/db-client/migrations/   → no matches
```

No prior session has created these tables, confirming `00-overview.md` §5's scope is genuinely new work, not a re-check of something already shipped (unlike, e.g., Phase 2B's discovery that `INVENTORY_BATCH`'s underlying schema was already 90% shipped by a prior session).

## 4. Why the backfill is provably lossless

`vertical` is `NOT NULL DEFAULT 'CLOTH_RETAIL'`, one of exactly two possible values today (enforced at the API boundary by `tenant.schemas.ts`'s enum — no code path can write a third value). A `business_types` table seeded with exactly `CLOTH_RETAIL` and `GROCERY` rows (matching `04-domain-model.md`'s original design) means `UPDATE tenants SET business_type_id = (SELECT id FROM business_types WHERE code = tenants.vertical)` is a total, lossless, 1:1 function over every existing row — there is no tenant whose `vertical` value could fail to resolve to a `business_types.id`, because the seed data is derived from the same closed set the column itself is constrained to. This is a stronger correctness guarantee than most backfills get to claim, and is the core reason this phase's risk profile is much lower than Phase 3's (`00-overview.md` §4).

## 5. Migration state

Latest migration: `0169_inventory_batch_capability.sql` (Phase 2B's), confirmed via `packages/db-client/migrations/meta/_journal.json`'s tail entry (`idx: 169`). **Phase 3's plan (`phase-03-hr-payroll-pos-enforcement/06-database-impact.md`) also proposes a conditional migration**, not yet written, not yet numbered. See `25-decision-record.md` D2 for the sequencing implication.

## 6. No existing test coverage for `TenantProvisioner`'s vertical-selection logic

```
find apps/tenant-service/src/__tests__ -iname "*provision*" -o -iname "*vertical*"   → no matches
```

This phase's testing strategy (`16-testing-strategy.md`) is not extending existing coverage — it is writing the first dedicated test for this logic, a gap that predates this phase and isn't caused by it.
