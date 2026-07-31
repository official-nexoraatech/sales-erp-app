# CRM-ROADMAP Phase 1, Feature 1 — Contact & Account Hierarchy — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Today `customers` is a flat table — a B2B/wholesale/distributor buyer with several stakeholders
(billing contact, decision maker, shipping contact, ...) had no way to be represented correctly.
This feature adds an account/contact layer on top of the existing customer model, per
`ERP-PLANNING/CRM-ROADMAP/10-PHASE-1-FOUNDATION.md`'s Feature 1 spec and `02-ARCHITECTURE-
RECOMMENDATIONS.md`'s AR-1 (stays inside `sales-service`, no new `crm-service`):

- New `crm_accounts` (the company/entity) and `crm_account_contacts` (the people attached to it,
  each with a role: Billing/Decision Maker/Shipping/Primary/Other) tables in
  `packages/db-client/src/schema/crm.ts`. `customers.account_id` is an additive, nullable FK —
  every existing POS/retail customer flow is unaffected.
- `AccountService` (`apps/sales-service/src/domain/AccountService.ts`): scored, indexed-lookup
  duplicate detection (never a full-table scan — GSTIN/phone/email exact-match, graduated
  confidence, never auto-merge), account merge (re-points every contact and customer under the
  source account to the target, keeps the source row for traceability via `mergedIntoAccountId`
  rather than deleting it), and lazy implicit-account creation for a customer's first
  B2B-relevant action.
- New `apps/sales-service/src/api/account.routes.ts`: `/accounts` CRUD, `/accounts/dedupe-check`,
  `/accounts/merge`, `/accounts/for-customer/:customerId` (get-or-create), and
  `/accounts/:id/contacts` CRUD (contact create/update mirrors `supplier_contacts`' existing
  primary-exclusivity pattern exactly — only one contact can be primary per account).
- `customers` gains an optional `accountId` field on create/update (unchanged shape otherwise);
  `GET /customers` now left-joins `crm_accounts` so the list can show account-level grouping
  without an N+1 lookup per row.
- Four new permission constants — `CRM_ACCOUNT_VIEW/CREATE/UPDATE/MERGE` — granted to
  `SALES_MANAGER` (merge is the higher-risk one, deliberately not given to a lower tier; this
  codebase has no separate `SALES_REP` role to hold it back from).
- Frontend: `CrmAccountsPage`/`CrmAccountFormPage`/`CrmAccountDetailPage` under
  `apps/web-frontend/src/pages/crm/`, a new "Accounts" nav item under CRM, and a "+ Create B2B
  account" / linked-account-name affordance added to the existing Customer detail page.

## Deviations from the roadmap doc (flagged during implementation, not silently decided)

1. **Permission/schema/component naming.** The roadmap doc names the new permissions
   `ACCOUNT_VIEW`/`ACCOUNT_CREATE`/`ACCOUNT_UPDATE`/`ACCOUNT_MERGE` and implies files named
   `accountApi.ts`/`AccountFormPage.tsx`. All four collide with **already-existing** identifiers
   for an unrelated resource — the Chart of Accounts (`packages/shared-types/src/permissions.ts`'s
   existing `ACCOUNT_VIEW/CREATE/UPDATE`, `apps/web-frontend/src/api/endpoints.ts`'s existing
   `accountApi` object, and `apps/web-frontend/src/pages/accounting/AccountFormPage.tsx`). Reusing
   any of these would have silently overwritten an existing grant/export rather than adding a new
   one. Renamed to the `CRM_ACCOUNT_*`/`crmAccountApi`/`CrmAccountFormPage.tsx`/
   `schemas/crmAccount.schema.ts` family throughout — see the inline comments left at each
   collision point for future sessions.
2. **No separate `crm_contact_roles` lookup table.** `03-DATABASE-MIGRATION-PLAN.md` lists
   `crm_contact_roles` as its own table. Nothing in this feature's acceptance criteria or
   Playwright scenarios requires a tenant to define custom role types beyond the five named in
   the spec itself (Billing/Decision Maker/Shipping/Primary/Other) — a separate manageable
   catalog would be unused configurability (see `customerSegments`' own "system segment" codes,
   which are handled the same way, as a fixed vocabulary with no backing table). `role` is a
   constrained varchar enum column directly on `crm_account_contacts` instead.
3. **`lastContactedAt` is a plain settable column, not computed from activity.** The spec's UI
   description lists "last contacted" as a contacts-table column but doesn't require deriving it
   from `customer_interactions` (which are keyed to `customerId`, not `accountContactId`).
   Implemented as a nullable timestamp column, shown as "—" until set — avoids inventing a new
   activity-linking system not otherwise requested.

## Acceptance Criteria

- [x] A B2B customer can have 3+ contacts with distinct roles — `CrmAccountDetailPage`'s contact
      table + `POST /accounts/:id/contacts`, each contact independently tagged with one of
      Billing/Decision Maker/Shipping/Primary/Other.
- [x] The customer list and Customer 360 both correctly show account-level aggregation — `GET
/customers` left-joins `crm_accounts` for an `accountName` column; `CustomerViewPage` shows
      the linked account (name + link) or a one-click "+ Create B2B account" action.
- [x] POS/retail flow is provably unaffected — `customers.account_id` is nullable and additive,
      no existing column renamed/removed; `sync-routes` and other pre-existing customer paths
      read/write the same row shape as before.
- [x] Dedupe suggestion tested with both a true-positive (GSTIN match, high score) and a
      false-positive-safe case (weaker phone-only match scored lower, and an unrelated
      gstin/phone/email never surfaces a candidate at all) — `account-service.test.ts`, all 3
      `findDuplicateCandidates` cases passing live against a real Postgres instance.
- [x] Merge is reversible via audit log (not literally undoable, but fully traceable) — the
      source account's row is kept, never deleted, with `mergedIntoAccountId` set;
      `ctx.audit.log` records the merge action with both IDs and the re-pointed row counts.
- [x] Two contacts marked "primary" on the same account cannot happen — enforced the same way
      `supplier_contacts` already does: any primary-flag set clears every other contact's primary
      flag on that account first, inside the same transaction.
- [x] A contact with no email/phone is still valid — both columns nullable, no validation
      requires either.
- [x] Merging accounts with conflicting outstanding-balance records never drops either balance —
      balances live on individual `customers` rows, which are re-pointed (not merged/deleted)
      by an account merge; covered directly in `account-service.test.ts`'s merge test.

## Verification performed this session

- `pnpm --filter @erp/types build` / `pnpm --filter @erp/db build` — clean (required before the
  new schema/permission exports are visible to consuming services' type-checks).
- `pnpm --filter sales-service type-check` — clean.
- `pnpm --filter tenant-service type-check` — clean (after the `role-defaults.ts` edit).
- `pnpm --filter web-frontend type-check` — clean.
- `eslint` scoped to every touched/new file — 0 errors (pre-existing-style warnings only, e.g.
  `no-non-null-assertion` in tests, matching every other `*.integration.test.ts` in this service).
- **Live migration + integration test run** against the local dev Postgres
  (`erp-postgres-primary`, port 5435): applied `0105_crm_account_hierarchy.sql` and
  `0106_crm_account_permission_backfill.sql` directly (this dev DB's own migration bookkeeping
  is 17 migrations behind its journal/file count independent of this feature — see "Known
  issues" below), then ran `apps/sales-service/src/__tests__/account-service.test.ts` against
  it: **5/5 passing** (dedupe true-positive/weak-match/true-negative, merge re-pointing +
  balance preservation, implicit-account creation + idempotency). Verified the new
  `GET /customers` join directly via `psql` as well.
- `pnpm --filter @erp/types test` (route-guard-coverage backstop) — `account.routes.ts`'s new
  routes are **not** in the failure list (every route carries `requirePermission(`); the test's
  2 failures are pre-existing, in files this feature never touched
  (`notification-service/template.routes.ts`, `tenant-service/organization.routes.ts`).
- `pnpm --filter sales-service test` (full suite) — **not a clean signal this session**: 44
  pre-existing failures across 12 files, all a uniform 401-instead-of-expected-status pattern in
  routes this feature never touched (quotations, sale-returns, sync). `git status` shows
  uncommitted, in-flight changes in `apps/auth-service/**` and `packages/platform-sdk/src/auth.ts`
  from a concurrent session on this same working tree — that is the far more likely cause than
  anything in this feature (this feature's own tests, which don't go through the HTTP/JWT layer,
  pass cleanly). Flagging rather than touching those files.

## Files touched

- `packages/db-client/src/schema/crm.ts` — `crmAccounts`/`crmAccountContacts` tables + type
  exports.
- `packages/db-client/src/schema/master.ts` — `customers.accountId` nullable column + index.
- `packages/db-client/migrations/0105_crm_account_hierarchy.sql` — new tables + column.
- `packages/db-client/migrations/0106_crm_account_permission_backfill.sql` — new; backfills
  `CRM_ACCOUNT_VIEW/CREATE/UPDATE/MERGE` for existing tenants' `SALES_MANAGER` role.
- `packages/db-client/migrations/meta/_journal.json` — appended entries for both migrations above
  (this repo's hand-written-migration convention — `drizzle-kit migrate` only applies what's in
  the journal, see prior `db_migration_bookkeeping_broken` incidents).
- `packages/shared-types/src/permissions.ts` — new `CRM_ACCOUNT_VIEW/CREATE/UPDATE/MERGE`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — added the four new constants to
  `SALES_MANAGER`.
- `apps/sales-service/src/domain/AccountService.ts` — new.
- `apps/sales-service/src/api/account.routes.ts` — new.
- `apps/sales-service/src/api/customer.routes.ts` — optional `accountId` field on create/update;
  `GET /customers` left-joins `crm_accounts` for `accountName`.
- `apps/sales-service/src/main.ts` — registered `accountRoutes`.
- `apps/sales-service/src/__tests__/account-service.test.ts` — new; 5 tests.
- `apps/web-frontend/src/api/endpoints.ts` — new `crmAccountApi`.
- `apps/web-frontend/src/schemas/crmAccount.schema.ts` — new.
- `apps/web-frontend/src/pages/crm/CrmAccountsPage.tsx` / `CrmAccountFormPage.tsx` /
  `CrmAccountDetailPage.tsx` — new.
- `apps/web-frontend/src/lib/navigation.ts` — new "Accounts" nav item under CRM.
- `apps/web-frontend/src/App.tsx` — new `/crm/accounts[/new|/:id|/:id/edit]` routes.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — shows linked account (name +
  link) or a "+ Create B2B account" action.
- `apps/web-frontend/src/pages/customers/CustomersPage.tsx` — new "Account" column.

## What is not done (remaining TODO)

| Item                                                      | Why deferred                                                                                                            | Target                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Data Import / CSV bulk account import                     | Explicitly a separate feature (Feature 7) in this same phase doc                                                        | Phase 1, Feature 7                      |
| Playwright E2E specs for the 4 scenarios in the phase doc | Not run this session (no browser harness invoked); logic covered instead by a live DB integration test                  | Follow-up before phase sign-off         |
| Full merge target picker with fuzzy/ranked search         | Built as a simple name-search list (10 results); good enough for the acceptance criteria, not a ranked/paginated picker | Revisit if real usage shows it's needed |

## Deployment Checklist

- [ ] Run migrations `0105_crm_account_hierarchy.sql` and
      `0106_crm_account_permission_backfill.sql` against every target database (staging/prod) —
      verified applied and working against the local dev DB this session only.
- [ ] This dev DB's migration bookkeeping is 17 migrations behind its own journal/file count
      (`0088` onward were on disk but not in `drizzle.__drizzle_migrations` before this session) —
      pre-existing, not caused by this feature, but worth a dedicated session before relying on
      `pnpm db:migrate`'s "success" output on any environment sharing this state (see
      `db_migration_bookkeeping_broken` memory).
- [ ] No new environment variables.
