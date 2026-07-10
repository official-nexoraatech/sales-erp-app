# [PG-037] Departments / Cost Centers

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Accounting
**Priority:** Low
**Complexity:** L — no existing partial implementation; needs a new dimension table, an additive nullable column threaded through journal posting end-to-end, and a new report cut, but does not touch double-entry balancing logic itself
**Depends on:** none
**Blocks:** none — this is Phase 9 (Enterprise Enhancements), explicitly deferred past core production-readiness (see `000-Master-Roadmap.md`, Phase 9 section)
**Primary service(s)/package(s):** apps/accounting-service, packages/db-client

---

## Overview

- **Business objective:** today every rupee posted to the ledger is attributable only to a tenant (and, in theory, a branch — see correction below). A tenant that wants to know "how much did the Tailoring department spend this month" or "what's the P&L for the Andheri store vs. the Bandra store as a cost center, not just a branch" has no way to ask that question — the Chart of Accounts and every journal line carry no department/cost-center tag at all. This is a common ask once a tenant grows past a single-owner-operator shop into a multi-department or multi-branch retail chain wanting departmental accountability, but it is **not** a blocker for the ERP's current core production-readiness scope — no current tenant has asked for it, and `FEATURE_INVENTORY.md` §5.6 lists it alongside multi-currency as explicitly out of scope today ("No multi-currency, no departments/cost-centers").
- **Current implementation:** confirmed by direct read of `packages/db-client/src/schema/accounting.ts` — the `accounts` table (Chart of Accounts, lines 17-60+) has `id`, `tenantId`, `parentId`, `accountCode`, `name`, `accountType`, `accountSubType`, `normalBalance`, `isBank`/`isCash`/`isSystem`, opening-balance fields — no `departmentId`/`costCenterId` column anywhere. The `journals` table (lines 141-170) and `financialEntries` table (lines 176-199) likewise have no such column — `financialEntries` carries only `tenantId`, `journalId`, `accountId`, `accountCode`, `accountName`, `debitAmount`, `creditAmount`, `description`, `referenceType`, `referenceId`, `narration`. A tenant-wide grep for `costCenter`/`departmentId` across `packages/db-client/src` returns zero matches outside `apps/hr-service`'s `hr.ts` schema (employee department assignment — an HR org-chart concept, unrelated to and not wired into accounting).
- **Correction to this gap's stated framing:** the task framing describes today's postings as "tenant/branch-level only." Direct read of `apps/accounting-service/src/domain/ReportsEngine.ts` shows this is not quite accurate — `getTrialBalance`/`getPnL`/etc. all accept an optional `branchId?: number` parameter, but every one of their SQL queries (e.g. lines 105-126) filters `financial_entries`/`accounts` **only** by `tenant_id` — `branchId` is accepted but never referenced in any `WHERE`/`JOIN` clause, because `financial_entries` has no `branch_id` column to filter on. So postings today are **tenant-level only**; the `branchId` parameter on `ReportsEngine`'s report methods is dead/vestigial. This is a separate, smaller, pre-existing bug worth flagging to whoever owns branch-level reporting — **it is out of scope for this package** (this package is additive net-new cost-center support, not a fix for the dead `branchId` param), but a future implementer should not assume branch-level filtering already works when reading `ReportsEngine.ts`.
- **Current architecture:** all cross-service event consumers that post journals (`InvoiceAccountingConsumer`, `PaymentAccountingConsumer`, `GRNAccountingConsumer`, etc. in `apps/accounting-service/src/consumers/`) build `financialEntries` rows via the `PostingMatrixService`/`postingMatrix`-table-driven event→debit/credit-account mapping (`packages/db-client/src/schema/accounting.ts` lines 202-219) — this pattern has no concept of a dimension beyond the resolved account code.
- **Current limitations:** there is no `departments`/`cost_centers` reference table, no dimension column on `accounts`, `journals`, or `financial_entries`, no UI to assign a cost center to a manual journal entry or to tag a Chart-of-Accounts account with a default cost center, and no report that slices P&L by anything other than the account tree itself.

## Existing Code Analysis

- **What already exists and should be reused:** the `accounts` table's `parentId`-based tree structure (`packages/db-client/src/schema/accounting.ts`) is the right structural reference for how a `cost_centers` table should also support a simple parent/child hierarchy (e.g. "Retail Operations" → "Andheri Store", "Bandra Store"), since this codebase already has one tree-shaped reference-data pattern to copy rather than inventing a new hierarchy convention. `default-accounts.ts`'s seed-data pattern (42 accounts seeded per tenant on provisioning) is the right structural reference for how cost centers would be seeded/created (tenant-created via UI, not globally seeded — cost centers are tenant-specific organizational structure, unlike, e.g., PG-044's globally-seeded `pt_slabs`). `PostingMatrixService`'s event-driven posting construction (`apps/accounting-service/src/domain/` — confirmed present via the `postingMatrix` table) is the correct place to thread an optional cost-center resolution through, rather than inventing a parallel posting mechanism.
- **What should never be modified:** the existing DR=CR balance-validation trigger (`validate_journal_balance`, referenced in a comment at `accounting.ts` line 175) must not be touched — cost centers are an informational tag on a `financial_entries` row, not a balancing dimension; a journal must still balance in aggregate regardless of how many different cost centers its lines are tagged with. `ReportsEngine.ts`'s existing P&L/Trial-Balance/Balance-Sheet SQL must keep producing identical output for tenants that don't use cost centers — this is additive-only (a new optional `costCenterId` column, nullable, defaulting to `NULL`), consistent with the Master Roadmap's "no breaking API version bump" convention.
- **Prior related work:** none — `FEATURE_INVENTORY.md` §5.6 and §8 both list this as a known, deliberate gap; no phase-completion report or audit doc has previously scoped it. PG-033 (Real Income Summary account) and PG-036 (Multi-currency) are the two other Accounting-category Phase-9/near-Phase-9 packages that reference `default-accounts.ts`'s seeding pattern — this package follows the same "don't touch the seed data, add alongside it" posture PG-036 already established.

## Architecture

- **Cost center as an optional dimension, not a mandatory one:** every journal line (`financial_entries` row) gains an optional `costCenterId` (nullable FK). Existing postings and all postings from tenants that never create a cost center are completely unaffected — this preserves backward compatibility with the live schema per the Master Roadmap's "gap-closures on a live schema/API surface, not a rewrite" rule, and per this template's own Existing Code Analysis guidance to keep the DR=CR balance trigger untouched.
- **Where the cost-center tag is set:** two entry points, both optional:
  1. **Account-level default:** an `accounts.defaultCostCenterId` (nullable FK) lets a tenant say "any posting to the Tailoring Wages expense account defaults to the Tailoring cost center" — this covers the common case without requiring every event-driven consumer (`InvoiceAccountingConsumer` etc.) to be individually taught about cost centers.
  2. **Manual override on manual journal entries:** the existing manual-journal-entry UI/route (wherever a human enters a journal directly, as opposed to an event-driven consumer) gains an optional cost-center picker per line, which overrides the account's default when set.
  - Event-driven consumers (`InvoiceAccountingConsumer`, `PaymentAccountingConsumer`, `GRNAccountingConsumer`, etc.) are **not required to change in this package's v1** — they can simply inherit the posted-to-account's `defaultCostCenterId` at write time (a lookup already happening implicitly via the `PostingMatrixService`'s existing account-code resolution, so this is a small addition to that existing lookup, not a new architecture).
- **Component/data flow:** `financialEntries` insert (from any consumer or manual entry) → resolve `costCenterId` (explicit override, else `accounts.defaultCostCenterId` for the resolved `accountId`, else `NULL`) → store on the row → `ReportsEngine` gains one new report method, `getPnLByCostCenter(tenantId, costCenterId?, dateRange)`, additive alongside the existing `getPnL` (not a replacement — a tenant with no cost centers configured never calls the new method).
- This section deliberately stays at a moderate depth appropriate to an L-complexity, Phase-9, not-yet-committed feature — a dedicated design pass on cost-center hierarchy depth (single-level vs. multi-level like `accounts.parentId`) should happen at implementation time, matching whatever the specific customer commitment that triggers this package actually needs.

## Database Changes

- New table `cost_centers`: `id, tenant_id, code (varchar, unique per tenant), name, parent_id (nullable, self-referencing FK, mirrors accounts.parentId's tree pattern), is_active, created_at, updated_at, created_by`.
- New column `accounts.default_cost_center_id` (nullable FK to `cost_centers.id`) — additive, no default-breaking change.
- New column `financial_entries.cost_center_id` (nullable FK to `cost_centers.id`) — additive; every existing row backfills to `NULL` (no data migration needed since the column is nullable and no prior data can have a value).
- Migration: next sequential number in `packages/db-client/migrations/` after `0034_organization_theme_config.sql` (the latest at the time of this writing — re-verify before creating, since concurrent packages may have added migrations since).
- Rollback strategy: `DROP TABLE cost_centers` + `ALTER TABLE accounts DROP COLUMN default_cost_center_id` + `ALTER TABLE financial_entries DROP COLUMN cost_center_id` — fully reversible since no other table gains a foreign key into `cost_centers` beyond these two, and no existing row's `DEBIT`/`CREDIT` value depends on the new column.

## Backend

- `apps/accounting-service/src/domain/`: new `CostCenterService.ts` (CRUD for `cost_centers`, same static-class/Drizzle-query style as `PayrollEngine`/`PTSlabService`-shaped services elsewhere in the codebase) plus a small addition to whatever module currently resolves the debit/credit account for a posting (`PostingMatrixService` or equivalent) to also resolve `costCenterId` from the account's `defaultCostCenterId` when not explicitly overridden.
- New routes: `GET /cost-centers`, `POST /cost-centers`, `PATCH /cost-centers/:id`, `DELETE /cost-centers/:id` (soft-delete via `isActive`, matching the existing `accounts` soft-delete convention), all under `apps/accounting-service/src/api/` following the existing `accounts.routes.ts` structure (Fastify + Zod).
- Events/Kafka: not applicable — no new event type; existing `InvoiceAccountingConsumer`/`PaymentAccountingConsumer`/etc. gain the small additive cost-center-resolution step described in Architecture, but no payload-shape change is required to their input events (cost-center resolution happens entirely inside accounting-service from the account being posted to, not from data the producing service would need to send).
- Validation, authorization: new permission constant `COST_CENTER_MANAGE` (or reuse `ACCOUNTING_CONFIG_MANAGE` if that already exists as a broader accounting-configuration permission — verify at implementation time) gating the CRUD routes, following the existing `requirePermission()` preHandler convention used by every other accounting-service route.

## Frontend

- New Settings page (or a tab under the existing Chart-of-Accounts settings page) for cost-center CRUD, following the existing `AccountFormPage.tsx`/accounting-settings page conventions (ERP component library, `ERPDataGrid` for the list, `ERPFormField`/`ERPSelect` for the create/edit form).
- `AccountFormPage.tsx` (Chart of Accounts edit form) gains an optional "Default Cost Center" selector.
- The manual-journal-entry form (wherever it lives — verify exact file at implementation time) gains an optional per-line cost-center override selector.
- A new "P&L by Cost Center" view/tab on the existing P&L report page, gated behind the tenant actually having at least one active cost center configured (don't show an empty, confusing selector to tenants who never opted in).

## API Contract

- `GET /cost-centers` → `200 { data: CostCenter[] }`
- `POST /cost-centers` → request `{ code, name, parentId? }` → `201 { data: CostCenter }`
- `PATCH /cost-centers/:id` → request `{ name?, parentId?, isActive? }` → `200 { data: CostCenter }`
- `DELETE /cost-centers/:id` → soft-delete (`isActive: false`) → `204`
- `GET /reports/pnl-by-cost-center?costCenterId=&from=&to=` → `200 { data: PnLByCostCenterReport }` — additive alongside the existing P&L report endpoint, not a replacement.
- Error codes: standard `{error:{code,message}}` envelope matching every other accounting-service route; `404 COST_CENTER_NOT_FOUND`, `409 COST_CENTER_CODE_DUPLICATE` (unique-per-tenant code constraint violation).

## Multi-Tenant Considerations

- `cost_centers` is fully tenant-scoped (`tenant_id` on every row, explicit `WHERE tenant_id = ?` on every query) — unlike PG-044's `pt_slabs` (deliberately global statutory reference data), cost centers are tenant-specific organizational structure and must never leak across tenants.
- No feature-flag gating is strictly required (this is additive and invisible to tenants who never create a cost center), but a `cost_centers_enabled` tenant feature flag (following the existing `feature_flags` table convention — `packages/db-client/src/schema/index.ts`, `flagKey`/`enabled`/`config` shape) could be used to hide the new UI entirely for tenants not interested, avoiding UI clutter — recommend adding it for a cleaner rollout, following the same opt-in posture as PG-036's proposed `multi_currency_enabled` flag.

## Integration

- **accounting-service only** for the core dimension + reporting. No other of the 14 services needs to change for v1 — event-driven consumers inherit cost-center via the posted-to account's default, not via any change to the events sales-service/purchase-service/hr-service already produce.
- **web-frontend**: new Settings page + P&L report tab, as described above.

## Coding Standards

- Drizzle schema + migration convention matching `accounts`'/`cost_centers`' sibling tables in this repo.
- `CostCenterService` follows the same static-class-with-DB-param style as `PayrollEngine`/`PTSlabService` elsewhere in this codebase — no new architectural pattern introduced.
- Reuses the existing `feature_flags` table for opt-in gating rather than inventing a new settings mechanism, per the Master Roadmap's "check `@erp/sdk`/existing tables before introducing a new utility" guidance.

## Performance

- One additional nullable FK column on `financial_entries` (a high-write, partitioned-by-range table per its own schema comment) — negligible index/storage overhead; add an index on `(tenant_id, cost_center_id)` only if the new cost-center-filtered report proves slow in practice (defer until real usage data exists, since this is a Phase-9 feature with no current tenant).
- `getPnLByCostCenter` is a new, additive query — does not change the existing `getPnL`'s query plan or performance characteristics.

## Security

- New `COST_CENTER_MANAGE` permission gate (or reuse of an existing accounting-configuration permission) on all CRUD routes — no new attack surface beyond the standard `requirePermission()` + tenant-scoping pattern already used everywhere else in accounting-service.
- No PII or financial-amount exposure risk beyond what already exists in the Chart of Accounts / journal APIs — cost centers are organizational metadata, not a new sensitive-data category.

## Testing

- New `apps/accounting-service/src/__tests__/cost-centers.test.ts`: CRUD round-trip, tenant-isolation (a cost center created under tenant A is not visible/assignable under tenant B), unique-code-per-tenant constraint, soft-delete behavior.
- Extend whatever existing test file covers `PostingMatrixService`/event-driven journal posting to confirm: (a) a posting to an account with no `defaultCostCenterId` still posts successfully with `cost_center_id: NULL` (regression safety — no existing tenant's postings change); (b) a posting to an account with a `defaultCostCenterId` set correctly tags the resulting `financial_entries` row.
- Extend `ReportsEngine`'s existing test coverage with a `getPnLByCostCenter` case: correct filtering by cost center, and confirms the existing `getPnL` (no cost-center filter) output is byte-identical before/after this package for a tenant using cost centers (proving the new dimension is additive, not a behavior change to the existing report).

## Acceptance Criteria

- [ ] A tenant that never creates a cost center sees zero behavior change in the Chart of Accounts, journal posting, or any existing report (regression-safe).
- [ ] A tenant can create a cost center hierarchy (at least one level of parent/child), assign a default cost center to an account, and see that default correctly applied to new postings against that account.
- [ ] A manual journal entry can override the account's default cost center per line.
- [ ] The new `getPnLByCostCenter` report correctly slices P&L totals by cost center for a tenant that has tagged postings.
- [ ] `pnpm --filter accounting-service type-check` and `pnpm --filter accounting-service test` pass, including new cost-center tests.
- [ ] Migration is additive/reversible (`DROP TABLE`/`DROP COLUMN` cleanly rolls back with no impact on unrelated data).

## Deliverables

- **Files to create:** `apps/accounting-service/src/domain/CostCenterService.ts`, `apps/accounting-service/src/api/cost-centers.routes.ts`, `apps/accounting-service/src/__tests__/cost-centers.test.ts`, migration file for `cost_centers` table + `accounts.default_cost_center_id` + `financial_entries.cost_center_id`, new frontend Settings page for cost-center CRUD, new "P&L by Cost Center" report tab.
- **Files to modify:** `packages/db-client/src/schema/accounting.ts` (new table + two new nullable columns), the module resolving debit/credit accounts for event-driven postings (name to confirm at implementation time — `PostingMatrixService` or equivalent), `apps/accounting-service/src/domain/ReportsEngine.ts` (new additive `getPnLByCostCenter` method), `AccountFormPage.tsx` (default-cost-center selector), the manual-journal-entry form (per-line cost-center override).
- **Migrations:** one new migration (`cost_centers` table + two additive nullable columns), next sequential number after `0034` (re-verify current latest before creating).
- **APIs added/changed:** `GET/POST /cost-centers`, `PATCH/DELETE /cost-centers/:id`, `GET /reports/pnl-by-cost-center`.
- **Events added/changed:** none.
- **Tests added:** `cost-centers.test.ts`, extended `PostingMatrixService`/posting tests, extended `ReportsEngine` tests.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** this ERP's Chart of Accounts (`accounts`), journal headers (`journals`), and journal lines (`financial_entries`) — all in `packages/db-client/src/schema/accounting.ts` — carry no department/cost-center dimension whatsoever. Postings are tenant-level only (a `branchId` parameter exists on `ReportsEngine`'s report methods but is dead — never referenced in the underlying SQL, since `financial_entries` has no `branch_id` column). This is a deliberate, confirmed gap per `FEATURE_INVENTORY.md` §5.6, not an oversight, and is explicitly scoped Phase 9 (Enterprise Enhancements) — not a production-readiness blocker.

**Current Objective:** add an optional, additive cost-center dimension: a new tenant-scoped `cost_centers` reference table (simple parent/child tree, mirroring `accounts.parentId`'s existing pattern), an optional `accounts.defaultCostCenterId` for automatic tagging of event-driven postings, an optional per-line override on manual journal entries, and one new additive P&L-by-cost-center report — with zero behavior change for tenants that never create a cost center.

**Architecture Snapshot:** (1) `accounts` table already has a `parentId`-based tree structure to copy for `cost_centers`; (2) `financial_entries` is a high-write, range-partitioned table (per its own schema comment) — the new `cost_center_id` column must stay nullable and cheap; (3) `PostingMatrixService`/the account-code-resolution step already used by every event-driven consumer (`InvoiceAccountingConsumer` etc.) is the single place to add cost-center inheritance, not a per-consumer change; (4) `ReportsEngine.ts`'s existing `getPnL`/`getTrialBalance` methods must produce byte-identical output before/after this package for any tenant not using cost centers.

**Completed Components:** none — 100% net-new, no partial implementation anywhere.

**Pending Components:** this package does not address the separate, pre-existing dead `branchId` parameter on `ReportsEngine`'s report methods (flagged above as a correction, out of scope here) — that is a different bug for a different package/owner to pick up if branch-level reporting is ever prioritized.

**Known Constraints:** must be additive/nullable and must not touch the `validate_journal_balance` DR=CR trigger — cost centers are an informational tag, not a balancing dimension.

**Coding Standards:** see Coding Standards section above — Drizzle + Fastify + Zod + `requirePermission()`, following `accounts`'/`PayrollEngine`'s existing conventions; no new architectural pattern introduced.

**Reusable Components:** `accounts.parentId` tree pattern, `default-accounts.ts`'s seeding-pattern (structural reference only — cost centers are tenant-created, not globally seeded), `PostingMatrixService`'s existing account-resolution step, the `feature_flags` table for optional opt-in gating.

**APIs Already Available:** existing Chart-of-Accounts CRUD routes (`accounts.routes.ts`) as the structural template for the new `cost-centers.routes.ts`.

**Events Already Available:** not applicable — no new event type; existing accounting-relevant events (invoice/payment/GRN) need no payload change.

**Shared Utilities:** `@erp/logger`, `@erp/types` (`BusinessError`), standard Drizzle/`@erp/db` query patterns already used throughout `apps/accounting-service`.

**Feature Flags:** recommend a new `cost_centers_enabled` tenant feature flag (via the existing `feature_flags` table) to hide the new UI for tenants not opting in.

**Multi-Tenant Rules:** `cost_centers` is fully tenant-scoped (unlike PG-044's global `pt_slabs`) — every query must filter `tenant_id` explicitly, per this repo's no-RLS, application-enforced isolation convention.

**Security Rules:** new `COST_CENTER_MANAGE` permission (or reuse of an existing broader accounting-configuration permission — confirm at implementation time) on all CRUD routes.

**Database State:** new `cost_centers` table + `accounts.default_cost_center_id` + `financial_entries.cost_center_id`, next sequential migration after `0034_organization_theme_config.sql` (re-verify current latest before creating — concurrent packages may have added migrations since).

**Testing Status:** no cost-center test coverage exists (feature doesn't exist yet). New test file plus extensions to existing posting/report test suites, per Testing section above.

**Next Session Plan:** single session — this is L, not XL, complexity; the dimension is narrow (one nullable FK threaded through one resolution point) even though it touches schema + backend + frontend + reporting.

**Prompt for the Next Session:** "Before implementing `ERP-PLANNING/production-gap-prompts/006-Accounting/58-departments-cost-centers.md` (PG-037), confirm with the product owner that cost centers are now prioritized (Phase 9 / enterprise-only, deliberately deferred past core production-readiness per `000-Master-Roadmap.md`). If confirmed: re-verify the current latest migration number in `packages/db-client/migrations/` (0034 at authoring time), re-verify the exact name of the module that resolves debit/credit accounts for event-driven postings (referred to here as `PostingMatrixService` — confirm this name against current code), and do not attempt to fix the separate dead-`branchId`-parameter bug in `ReportsEngine.ts` noted in this document's Overview — that is explicitly out of scope for this package."
