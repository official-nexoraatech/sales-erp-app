# 26 — Implementation Report

Implemented 2026-08-19, following `21-file-level-change-plan.md`, against D1's confirmed answer (`25-decision-record.md`: rename to `default_capability_keys`).

## 1. Executive Summary

**Implemented and verified against live infrastructure.** `industries`/`business_types` tables exist, seeded correctly; `tenants.business_type_id` exists and is backfilled for all 28 existing dev tenants with zero mismatches; `TenantProvisioner` resolves and sets it for every new tenant going forward. All 5 confirmed `vertical`-reading call sites are unmodified. Full `tenant-service` regression suite passes (64/65, 1 pre-existing MinIO-gated skip, unrelated). Migration applied to real Postgres, not just planned.

## 2. Files Changed

| File                                                                 | Change                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db-client/migrations/0170_business_profile_foundation.sql` | New — tables, seed data, column, backfill                                                                                                                                                                     |
| `packages/db-client/migrations/meta/_journal.json`                   | New entry, `idx: 170`                                                                                                                                                                                         |
| `packages/db-client/src/schema/tenant.ts`                            | Added `industries`, `businessTypes` tables (placed alongside `planEntitlements`, matching that table's "global reference data" convention); added `tenants.businessTypeId` column; added 4 new exported types |
| `apps/tenant-service/src/domain/TenantProvisioner.ts`                | Resolves `businessTypeId` from `businessTypes` by `vertical` code, writes it in the same insert as `vertical`                                                                                                 |
| `apps/tenant-service/src/__tests__/tenant.integration.test.ts`       | Extended (not replaced) both existing provisioning tests (`CLOTH_RETAIL`, `GROCERY`) with `businessTypeId` resolution assertions                                                                              |

## 3. Deviation from the plan, documented not silent

**No separate `setTenantBusinessType()` helper file was created.** The plan (`05-service-impact.md`) flagged this as `TO VERIFY` at implementation time. Reading `TenantProvisioner.ts` found exactly one call site that would ever use it (the provisioning insert) — no update/change-business-type route exists anywhere in this codebase today. Per CLAUDE.md §2 ("no abstractions for single-use code"), the resolution logic was inlined directly into `provision()` instead of a new file with one caller. If a future phase adds a route to change an existing tenant's business type, extracting a shared helper at that point is trivial and well-motivated by a second real call site — not done speculatively here.

## 4. Database Changes

Applied directly to the dev Postgres instance (`erp-postgres-primary`, via `docker exec ... psql`), not left unexecuted:

- `CREATE TABLE industries`, `CREATE TABLE business_types` — succeeded.
- Seed: 1 industry (`COMMERCE`), 2 business types (`CLOTH_RETAIL` → `[]`, `GROCERY` → `["INVENTORY_BATCH"]`) — verified via direct `SELECT`.
- `ALTER TABLE tenants ADD COLUMN business_type_id` — succeeded.
- Backfill `UPDATE` — reported `UPDATE 28`, matching the real tenant count.
- **Correctness independently re-verified by SQL**, not merely assumed from the `UPDATE` row count: a `LEFT JOIN` query confirmed 0 tenants with `business_type_id IS NULL` and 0 tenants where `business_types.code` disagrees with `tenants.vertical`, across all 28 rows.

`packages/db-client`'s own `migration-journal-integrity.test.ts` (5 tests) re-run after the journal edit — passes, confirming the new entry's shape is valid.

## 5. Tests Executed

| Suite                                                                         | Result                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db-client` typecheck (`tsc --noEmit`)                               | Clean, 0 errors                                                                                                                                                                                                               |
| `packages/db-client` build (`tsc`)                                            | Clean; `dist/schema/tenant.js` confirmed to contain the new exports before dependent typecheck ran (dist-based resolution gotcha, per `shared_package_rebuild_needed_for_typecheck` memory)                                   |
| `apps/tenant-service` typecheck                                               | Clean, exit 0                                                                                                                                                                                                                 |
| `apps/tenant-service` full suite, no `DATABASE_URL`                           | 55/55 passed, 10 pre-existing skips (unchanged from pre-implementation baseline)                                                                                                                                              |
| `apps/tenant-service` full suite, real `DATABASE_URL`                         | **64/65 passed**, 1 skip (MinIO-gated test, requires `MINIO_ENDPOINT`, unrelated to this phase)                                                                                                                               |
| `apps/tenant-service/src/__tests__/tenant.integration.test.ts` alone, real DB | 5/5 passed (1 MinIO-gated skip) — includes the two new `businessTypeId` assertions, both passing for real, not mocked                                                                                                         |
| `packages/db-client/src/__tests__/migration-journal-integrity.test.ts`        | 5/5 passed                                                                                                                                                                                                                    |
| Lint, `TenantProvisioner.ts`                                                  | 0 errors, 0 warnings                                                                                                                                                                                                          |
| Lint, `tenant.integration.test.ts`                                            | 0 errors, 43 warnings — all pre-existing `no-non-null-assertion` style, already the file's established idiom before this change; the two new assertions follow the identical existing pattern, no new lint pattern introduced |

**Nothing here was claimed passing without actually running it.** The integration test was executed against the real dev Postgres instance in this session, not left `describe.skipIf`-skipped and reported as proven.

## 6. Backward Compatibility Verification

- All 5 confirmed `vertical`-reading call sites (`vertical-defaults.ts`, `default-accounts.ts`, `scheduler-internal.routes.ts`, `tenant.schemas.ts`, `tenant.routes.ts`'s audit echo) — zero diff, confirmed by `git diff --stat` scope matching exactly the 5 files in §2.
- Existing tenants: zero behavior change — `business_type_id` is additive, read by nothing yet.
- Existing `POST /admin/tenants` API contract: zero change — `CreateTenantSchema` untouched.

## 7. Acceptance Criteria Status (`20-acceptance-criteria.md`)

All checked and verified against live infrastructure — see `20-acceptance-criteria.md` for the updated checklist (all boxes now `[x]`).

## 8. Known Limitations

- The optional `tenant.routes.ts` audit-payload extension (recording `businessTypeId` alongside `vertical` in `TENANT_CREATED`) was **not done** — explicitly optional per `05-service-impact.md`, low value, not required by any acceptance criterion.
- `default_capability_keys` seed data remains descriptive-only — no provisioning-time consumer exists yet (out of scope, `00-overview.md` §7), unchanged from the plan.

## 9. Final Status

**Phase 4 (Business Profile Foundation) implementation and verification is complete.** Migration applied to and verified against real Postgres; code changes typecheck, lint clean, and pass regression (including the previously-unexecuted integration test, now run for real). No `industries`/`business_types` consumer is built — that remains correctly out of scope for a future phase.
