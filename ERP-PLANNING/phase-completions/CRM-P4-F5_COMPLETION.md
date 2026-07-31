# CRM-ROADMAP Phase 4, Feature 5 — Sales Forecasting & Quota Management — Completion Report

**Date:** 2026-07-30
**Status:** Complete, tested against a real local Postgres, zero regressions in every touched
service's full test suite.

## Summary

Formal quota-setting and rollup beyond Pipeline's (Phase 2) derived forecast, extending the
Territory Management work (Phase 4, Feature 4) shipped earlier this session. Built directly on
top of it: a quota's subject is either a REP (`users.id`) or a TERRITORY (`crm_territories.id`)
— no separate "team" entity, since research confirmed none exists anywhere in this codebase; a
territory already serves as a named group of branches+reps, so a "team quota" is a TERRITORY
quota under this model.

### Backend

- **Schema** (migration `0138_crm_sales_quotas.sql`): `crm_sales_quotas` —
  `subjectType: 'REP'|'TERRITORY'`, exactly one of `subjectUserId`/`subjectTerritoryId` set
  (validated in `QuotaService`, not a DB CHECK constraint — this codebase has no DB-level FKs/
  CHECK constraints elsewhere either), `periodYear`/`periodMonth` as an integer pair (mirroring
  the existing `period_closures` convention in accounting-service, not a date range or a
  "2026-Q3" string), `quotaAmount`, version.
- **Permissions** (migration `0139_crm_quota_permission_backfill.sql` + `role-defaults.ts`):
  `QUOTA_MANAGE` (CRUD, Sales Ops admin action, same single-permission precedent as
  `TERRITORY_MANAGE`) and `QUOTA_VALUE_VIEW` (field-level gate on the $ figures — same precedent
  as `OPPORTUNITY_VALUE_VIEW`: a derived aggregate like `attainmentPct` "can leak the same
  commercially sensitive information as the raw value it's computed from," so it's gated
  identically, not treated as safe just because it's a percentage). Both granted to
  OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER — no behavior change for any existing role today, same
  as the `OPPORTUNITY_VALUE_VIEW` precedent.
- **`QuotaService`** (new, `apps/sales-service/src/domain/QuotaService.ts`): CRUD with
  optimistic locking (only `quotaAmount` is editable — subject/period are the record's identity,
  so a mid-period amount change is never a silent historical rewrite: each period is its own
  row, and the version bump + audit log entry are the explicit trail the roadmap's own flagged
  edge case calls for), duplicate-quota rejection (one quota per subject per period), and
  `getAttainment` — computes "actual" revenue from **won opportunities only**
  (`crmOpportunities.value` where `wonAt` falls inside the period), for both REP and TERRITORY
  subjects.
- **Deliberate scope decision on "actual" revenue** (flagged, not silently decided): the roadmap
  spec says actual should come from "Opportunities won + Invoices." Research confirmed invoices
  in this codebase have **no rep-attribution column at all** (only `branchId`/`createdBy`), so a
  REP-level quota has no reliable invoice-based actual to compute in the first place. Summing
  invoices.grandTotal on top of won-opportunity value for the TERRITORY case would also risk
  double-counting the same deal (a won opportunity auto-creates a quotation, which may convert to
  an invoice with a related-but-not-identical total). Using won-opportunity value alone for both
  subject types keeps REP and TERRITORY numbers comparable on the same basis and avoids both
  problems — at the cost of not counting walk-in/POS sales that were never tracked as a CRM
  Opportunity. This is a known, documented limitation, not an oversight.
- **`apps/sales-service/src/api/quota.routes.ts`** (new): `GET`/`POST /quotas`,
  `PUT /quotas/:id`, `GET /quotas/attainment`. `GET /quotas` and `GET /quotas/attainment` both
  apply `omitFieldsFromListWithoutPermission`/`omitFieldsWithoutPermission` (the same
  `field-visibility.ts` mechanism `OPPORTUNITY_VALUE_VIEW` uses) so a caller with `QUOTA_MANAGE`
  but not `QUOTA_VALUE_VIEW` can see which quotas/subjects exist without seeing the $ amounts.
- **`CrmDashboardService.getQuotaAttainment`** (thin delegate to `QuotaService.getAttainment`)
  wired into the existing `GET /crm/dashboard` composed-read endpoint (Phase 1, Feature 8) as a
  4th independently-gated section (`QUOTA_MANAGE`), following the same "hidden if the caller
  lacks the permission, never a 403 for the whole dashboard" discipline as the 3 existing
  sections. Deliberately **not** branch-scope-filtered like the other 3 sections — quotas are
  scoped by their own subject (a rep or territory), and only `QUOTA_MANAGE` holders (Sales Ops
  admins) can reach this section at all, so a tenant-wide view is the correct default.

### Frontend

New `apps/web-frontend/src/pages/crm/QuotasPage.tsx` (list + create form, period selector,
inline quota-amount edit), registered at `/crm/quotas`, nav entry added under CRM. A new "Quota
Attainment" card added to the existing `CrmDashboardPage.tsx`, following the same
omitted-not-error rendering pattern the other 3 cards already use, plus a graceful
"you don't have permission to view the amounts" message when the $ fields are omitted.

## Testing performed this session

- `pnpm --filter @erp/types build` / `@erp/db build` — clean.
- `pnpm --filter @erp/sales-service type-check` / `@erp/tenant-service type-check` /
  `@erp/web-frontend type-check` — all clean.
- Both migrations live-applied directly to the local dev Postgres (same `db:migrate`-is-broken
  caveat as the Portal and Territory features' own completion reports — not re-litigated here).
- **New tests, all passing**: `quota-service.test.ts` (10 tests — REP/TERRITORY quota creation,
  tenant-mismatch rejection, duplicate-subject-and-period rejection, optimistic-lock rejection,
  subjectName resolution, and 3 `getAttainment` cases: REP actual correctly excludes open/lost
  opportunities and opportunities won outside the period, TERRITORY actual sums across every
  branch in the territory, and a zero-quota returns `null` attainmentPct rather than dividing by
  zero), `quota-permission-guard.test.ts` (3 tests, including the `QUOTA_MANAGE`-vs-
  `QUOTA_VALUE_VIEW` layering).
- **Fixed a pre-existing test file this feature's own change legitimately broke**:
  `crm-dashboard-permission-guards.test.ts` had 3 hardcoded `hiddenSections` array assertions
  that didn't yet know about the new `quotaAttainment` section — updated all 3, and added 2 new
  test cases proving `quotaAttainment` is gated independently of the other 3 sections (present
  only for a caller holding `QUOTA_MANAGE` specifically, not just the other three permissions
  combined).
- **Full regression sweep** (run sequentially, one suite at a time, after a mid-session lesson
  about concurrent background test runs causing false timeouts — see
  [[turbo_parallel_test_false_failures]]): `sales-service` (542/543 — the one remaining failure
  is the already-known, pre-existing, unrelated loyalty-tier-demotion bug from earlier
  CRM-ROADMAP Phase 2 work), `tenant-service` (53/53).
- `route-guard-coverage.test.ts` / `dead-permission-constants.test.ts` — `quota.routes.ts` fully
  covered via the existing `requirePermission(` guard marker; only the same 2 pre-existing,
  unrelated failures already flagged in the Portal feature's completion report remain.
- `pnpm --filter @erp/sales-service lint` / `@erp/web-frontend lint` — both back to their
  pre-existing error-count baseline (2 and 16 respectively) after fixing one unused-import error
  this feature's own test file introduced.

## What is not done (remaining TODO)

| Item                           | Why deferred                                                                                    | Target                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Invoice-based "actual" revenue | No rep-attribution column exists on `invoices` today (see the deliberate scope decision above)  | Only if/when invoices gain a rep-attribution column |
| Playwright E2E coverage        | Not run this session                                                                            | Follow-up                                           |
| Delete route for quotas        | Not requested; matches the no-hard-delete precedent of `crm_territories`/`crm_assignment_rules` | Only if a real need surfaces                        |

## Deployment Checklist

- [ ] Apply migrations `0138_crm_sales_quotas.sql` and `0139_crm_quota_permission_backfill.sql`
      to every real tenant's database — same `db:migrate`-is-broken caveat as the Portal/
      Territory features' own completion reports; apply the SQL files directly if the migrate
      CLI still doesn't work by then.
