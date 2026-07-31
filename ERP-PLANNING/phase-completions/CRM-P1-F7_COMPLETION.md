# CRM-ROADMAP Phase 1, Feature 7 — Data Import / Dedupe / Merge Tooling — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Onboarding blocker: bulk CSV import for CRM Accounts and Leads, with duplicate-suggestion
warnings before commit. Per the phase doc, this feature is tooling on top of existing
infrastructure, not a new subsystem:

- **Extended scheduler-service's existing `ImportEngine`** (already fully supported
  customer/supplier/item/employee/opening-stock/attendance end-to-end) with two new entity
  types, `'account'` and `'lead'` — same upload → map → validate → execute → status → rollback
  state machine, same `import_jobs` table (no new job-status table, per the phase doc's own
  "verify before adding one" instruction — confirmed one already existed and is entity-generic).
- **Reused Feature 1's dedupe-scoring algorithm, not reimplemented.** `AccountService`'s scored
  duplicate-match logic (GSTIN/phone/email/name-similarity) was extracted into
  `packages/shared-utils` as `scoreDuplicateMatch()` (+ `normalizePhone`/`normalizeEmail`), so
  both the interactive create/merge flow (sales-service) and the new CSV dedupe-preview
  (scheduler-service) use exactly one implementation — same "one algorithm, not two" convention
  established for `matchesDltTemplate` in Feature 6.
- **Dedupe warnings are non-blocking**, per Feature 1's own "suggested, not auto-merged"
  requirement: `ImportEngine.validate()` now returns `ValidationError[]` entries with an added
  `severity: 'ERROR' | 'WARNING'` field — WARNING entries (possible duplicates) are shown in the
  preview step but never prevent the job from reaching `VALIDATED` status; only real schema
  errors (severity `'ERROR'`, the pre-existing behavior) block it.
- **Account dedupe** checks a CSV row's GSTIN/phone/email against existing `crm_accounts` in one
  batched query (not per-row), then scores each row with the shared algorithm. **Lead dedupe**
  checks a CSV row's phone against both existing `crm_leads` and existing `customers` — the two
  "already have this person" cases the phase doc calls out.
- **`import_batch_id` tagging + real rollback deletion.** The phase doc's DoD explicitly requires
  this ("tag imported rows... so rollback is possible cleanly"). Added a nullable
  `import_batch_id` column to `crm_accounts`/`crm_leads` (additive migration), set to the
  scheduler job's id on every row `execute()` creates. `ImportEngine.rollback()` now actually
  **deletes** the rows a completed account/lead import job created (filtered by
  `import_batch_id` + `tenantId`), not just flips job status — unlike every pre-existing entity
  type's rollback, which has never deleted anything (a pre-existing gap, left unfixed since this
  feature's DoD only required it for the entities it touches).
- **Frontend**: two new single-flow import pages (`CrmAccountImportPage.tsx`,
  `LeadImportPage.tsx`), mirroring the one existing import UI in the app
  (`SupplierImportPage.tsx` — upload → auto-map → validate → execute, no separate wizard steps),
  plus an "Import" button on the Accounts list and Leads Kanban board. Both new pages render
  dedupe warnings in a distinct panel from blocking errors.
- **No sales-service relay was built.** Investigated two conflicting existing patterns
  (hr-service's employee-import route DOES relay multipart→scheduler-service; sales-service's
  `POST /customers/import` is a stub telling the caller to hit scheduler-service directly) and
  confirmed via the frontend's existing `importApi` (already fully generic over `entityType`,
  already calls scheduler-service directly through the gateway's `/api/scheduler/*` upstream)
  that direct-to-scheduler is the pattern actually in use today — `SupplierImportPage.tsx`
  already works this way. Zero `importApi`/gateway changes were needed; both are entity-agnostic.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Dedupe-scoring extraction location**: moved to `packages/shared-utils` rather than having
   scheduler-service import `AccountService` directly from sales-service's `src/` (an unusual
   cross-app dependency an earlier research pass flagged as worth resolving). scheduler-service
   now queries `crm_accounts` directly itself (same physical DB, same "no cross-service call
   needed" pattern as Features 5/6) and calls the shared scorer — not an HTTP call to
   sales-service.
2. **`import_batch_id` is a plain nullable integer, not an FK constraint** — this codebase
   doesn't enforce cross-service-owned-table FKs (import_jobs is scheduler-service's, crm_accounts/
   crm_leads are sales-service's, sharing one physical per-tenant schema); it's an attribution tag
   only, matching how `customers.convertedFromLeadId` etc. already work as untyped-FK integers.
3. **Rollback only deletes for `'account'`/`'lead'`**, not retroactively fixing the pre-existing
   no-op rollback for customer/supplier/item/employee/attendance — those entity types' rollback
   behavior is unchanged and out of scope; noted as a pre-existing gap, not silently fixed.
4. **Dedupe check is batched, not per-row**: one query fetches every existing account/lead/
   customer whose gstinHash/phone/email could match ANY row in the CSV, then scores in memory —
   avoids an N-query dedupe check on a 10,000-row import, per the phase doc's own "must not
   full-scan per keystroke"-style performance concern (originally about the interactive flow,
   same principle applied here).
5. **Customer CSV import was already supported before this feature** (pre-existing, dating from
   an earlier purchase-audit gap-fix) — Feature 7's actual net-new work is the Account/Lead entity
   types plus the dedupe-preview and batch-rollback mechanics, not a first-time import feature.

## Acceptance Criteria

- [x] A tenant can bulk-import leads/accounts from CSV with dedupe protection — covered directly
      (`ImportEngine.validate()` surfaces WARNING entries for phone/GSTIN/email matches before
      the row is ever inserted).
- [x] Clear per-row error reporting — blocking (`ERROR`) and non-blocking (`WARNING`) entries are
      both row-addressed (`row`, `column`/`field`, `message`) and rendered in distinct panels in
      the new frontend pages.
- [x] `import_batch_id` tagging verified to make a clean rollback possible — covered directly:
      `rollback()` deletes exactly the tagged rows for account/lead jobs, tested against a
      pre-existing non-CRM entity type to confirm it does NOT touch `crm_accounts`/`crm_leads`
      when the job wasn't one of those two types.
- [x] Malformed CSV (e.g. invalid GSTIN format) blocked before any rows are committed — the
      pre-existing all-or-nothing `VALIDATED`-status gate is unchanged; WARNING severity never
      participates in that gate, only `ERROR` does.
- [x] Duplicate-matching logic reused from Feature 1, not reimplemented — `scoreDuplicateMatch`
      in `@erp/utils` is the single implementation both `AccountService` and `ImportEngine` call.

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/utils build` / `@erp/types build` — all clean after
  schema (`import_batch_id`, `ValidationError.severity`) and shared-utils changes.
- `pnpm --filter sales-service type-check` / `scheduler-service type-check` /
  `tenant-service type-check` / `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type`/`no-non-null-assertion` warnings already present throughout
  this codebase, e.g. identical warnings already exist in `SupplierImportPage.tsx`).
- **Live migrations** applied directly to the local dev Postgres: `0114_crm_import_batch_tracking.sql`
  (import_batch_id columns + indexes) and `0115_crm_import_permission_backfill.sql` (208 rows —
  CRM_ACCOUNT_IMPORT/LEAD_IMPORT backfilled for OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER across all
  existing tenants).
- **New test file** `import-engine-crm.test.ts` (scheduler-service) — **12/12 passing**: template
  headers, account schema-error blocking, account dedupe-warning (non-blocking), lead
  dedupe-warning distinguishing customer-match vs. lead-match, both entity-specific permission
  gates (`CRM_ACCOUNT_IMPORT`/`LEAD_IMPORT`), both insert paths (`import_batch_id` + computed
  `gstinHash` / normalized phone verified on the inserted row), and rollback deletion scoped
  correctly (including a negative case: a non-CRM entity rollback touches neither table).
- **Regression**: pre-existing `ImportEngine.test.ts` — **16/16 passing**, zero change to
  customer/item/employee/attendance/opening-stock behavior. `account-service.test.ts`
  (Feature 1) — **5/5 passing**, confirming the dedupe-scoring extraction preserved identical
  scoring behavior.
- **Full scheduler-service suite**: **83/83 passing** (12 files), including the PG-010
  dual-registration test, confirming `import.routes.ts`'s existing `/api/v2` dual-registration
  is unaffected.
- **sales-service Features 1–6 regression sweep** (account-service, lead-service,
  lead-capture-auth-isolation, customer-360-degradation, ticket-service,
  customer-financial-snapshot, campaign-service): **125/125 passing**.
- `pnpm --filter tenant-service test` — **59/59 passing (1 pre-existing skip)**, confirming the
  `role-defaults.ts` SALES_MANAGER addition introduced no regression.
- `pnpm --filter @erp/types test -- route-guard-coverage` — same **2 pre-existing, unrelated**
  failures as every prior session in this roadmap (notification-service/template.routes.ts,
  tenant-service/organization.routes.ts); no new unguarded routes.
- **Noted, not caused by this session**: a full unscoped `sales-service` test run shows 44
  pre-existing failures (401 instead of 403) across files this session never touched
  (`crm-campaign-permission-guards.test.ts`, `quotation-sale-return-permission-guards.test.ts`,
  `payment-view-permission-guard.test.ts`, the `offline0*` idempotency suites, etc.) — confirmed
  via `git status` to trace to uncommitted, in-flight changes in `packages/platform-sdk/src/auth.ts`
  from a concurrent session (JWT issuer-claim mismatch), the same root cause already documented
  in this project's memory from Features 2–3. All of this session's own tests explicitly work
  around it or don't touch JWT verification at all (the new `import-engine-crm.test.ts` is
  pure-mock, no HTTP/JWT layer).

## Files touched

- `packages/shared-utils/src/index.ts` — new `scoreDuplicateMatch`, `normalizePhone`,
  `normalizeEmail`, `DUPLICATE_MATCH_SUGGESTION_THRESHOLD` (extracted from AccountService).
- `apps/sales-service/src/domain/AccountService.ts` — refactored to call the shared functions;
  behavior unchanged (verified by the pre-existing test suite passing unmodified).
- `packages/db-client/src/schema/crm.ts` — `importBatchId` column + index on `crmAccounts` and
  `crmLeads`.
- `packages/db-client/src/schema/scheduler.ts` — `severity` field on the schema-level
  `ValidationError` type.
- `packages/db-client/migrations/0114_crm_import_batch_tracking.sql`,
  `0115_crm_import_permission_backfill.sql` — new; both applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entries.
- `packages/shared-types/src/permissions.ts` — new `CRM_ACCOUNT_IMPORT`, `LEAD_IMPORT`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — SALES_MANAGER gains both new permissions.
- `apps/scheduler-service/src/domain/ImportEngine.ts` — `'account'`/`'lead'` entity schemas,
  `ValidationError.severity`, `findAccountDuplicateWarnings`/`findLeadDuplicateWarnings`,
  entity-specific permission checks in `execute()`, insert branches with `import_batch_id`
  tagging, batch-tagged deletion in `rollback()`.
- `apps/scheduler-service/src/api/import.routes.ts` — `VALID_ENTITIES` extended.
- `apps/scheduler-service/src/__tests__/import-engine-crm.test.ts` — new; 12 tests.
- `apps/web-frontend/src/pages/crm/CrmAccountImportPage.tsx`,
  `apps/web-frontend/src/pages/crm/LeadImportPage.tsx` — new.
- `apps/web-frontend/src/pages/crm/CrmAccountsPage.tsx`,
  `apps/web-frontend/src/pages/crm/LeadsKanbanPage.tsx` — "Import" entry-point button.
- `apps/web-frontend/src/App.tsx` — new `/crm/accounts/import`, `/crm/leads/import` routes.

## What is not done (remaining TODO)

| Item                                                            | Why deferred                                                                                                                                                                                    | Target                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Playwright E2E specs for the 3 scenarios in the phase doc       | Not run this session; logic covered instead by unit tests against a mocked DB                                                                                                                   | Follow-up before Phase 1 sign-off                         |
| Rollback for customer/supplier/item/employee/attendance imports | Pre-existing gap (rollback has never deleted rows for these types); this feature's DoD only required it for account/lead                                                                        | Separate fix, out of this feature's scope                 |
| Large-CSV async-job pattern (BullMQ)                            | The existing `ImportEngine` runs synchronously inside the HTTP request per-batch, for every entity type, not just account/lead — a pre-existing architectural choice this feature didn't change | Not planned unless a real timeout is observed in practice |

## Deployment Checklist

- [ ] Run migrations `0114_crm_import_batch_tracking.sql` and
      `0115_crm_import_permission_backfill.sql` against every target database (staging/prod) —
      verified applied against the local dev DB this session only.
- [ ] No new environment variables.
