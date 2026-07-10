# PG-026 — Scheduler Log-Only Stub Jobs — Real Implementations — Completion Report

**Date:** 2026-07-10
**Status:** All 23 identified stubs converted to real work. The tenant-iteration scheduling bug fixed. Three additional systemic bugs discovered along the way — two fixed, one (a deep workflow-engine bug) documented but deliberately not attempted. **No live DB/Redis this session** — verified via typecheck + new unit tests mocking fetch/DB, not end-to-end.

## Summary

Converted all 23 log-only stub jobs in `apps/scheduler-service/src/jobs/system-jobs.ts` to real work, following the exact `fetch`-with-`x-internal-key` pattern the 21 already-real jobs established. Also fixed the tenant-iteration bug this package's own investigation found: `main.ts`'s bootstrap loop called `registry.schedule(name)` for every job without ever passing a `tenantId`, so all 18 `tenantScoped: true` jobs — including two already-real ones (`search.full-reindex`, `search.incremental-sync`) — never actually ran against a real tenant. Fixing that surfaced a second bug: `JobRegistry.schedule()` never set a BullMQ `jobId`, so scheduling one job for multiple tenants would have collapsed into a single repeatable entry instead of one per tenant. Both are fixed together.

While researching the stubs, found and fixed two more pre-existing, unrelated, high-impact bugs (see "Bonus fixes" below) — flagged to the user mid-session and fixed with explicit approval, since they were outside PG-026's stated scope.

## Files Changed — Core PG-026 Scope

- `apps/scheduler-service/src/main.ts` — queries `tenants` for `status = 'ACTIVE'`, loops and calls `registry.schedule(name, tenantId)` once per active tenant for every `tenantScoped: true` job; non-scoped jobs unchanged. `registerSystemJobs` now also receives `db`/`storage` (needed by the platform-maintenance jobs).
- `apps/scheduler-service/src/JobRegistry.ts` — `schedule()` now passes `jobId: tenantId !== undefined ? `${name}:${tenantId}` : name` into BullMQ's `queue.add`, so each tenant's repeatable job is a distinct entry.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — all 23 stub handler bodies replaced; 2 pre-existing "real" jobs (`production.reorder-report`, `production.job-work-overdue-alert`) fixed and made `tenantScoped: true` (see Bonus fixes); new imports for direct-DB platform-maintenance jobs; new `deleteBatched` helper.
- **New internal (`x-internal-key`-guarded) endpoints**, one per stub group, added to each owning service's existing route files (not a separate file, following the precedent already set by `einvoice.routes.ts`'s `/gst/einvoice/retry-pending`):
  - `apps/accounting-service/src/api/scheduler-internal.routes.ts` (**new file**) — trial-balance snapshot, bank-reconciliation reminder.
  - `apps/report-service/src/api/report.routes.ts` — outstanding AR/AP summary.
  - `apps/production-service/src/api/internal.routes.ts` (**new file**) — reorder-required, job-work in-progress (internal-key versions of the two JWT-only routes the existing real jobs were mis-calling).
  - `apps/inventory-service/src/api/internal.routes.ts` — valuation snapshot, physical-verification reminder.
  - `apps/gst-service/src/api/gstr1.routes.ts` / `gstr3b.routes.ts` / `gstr2a.routes.ts` — auto-prepare, filing reminder, reconcile-run.
  - `apps/hr-service/src/api/payroll.routes.ts` — payroll prepare, salary-slip send.
  - `apps/sales-service/src/api/internal.routes.ts` — credit-limit review.
  - `apps/purchase-service/src/api/internal.routes.ts` — PO delivery reminder, pending-GRN alert.
- `apps/*/src/main.ts` (accounting-service, production-service) — new route files registered.
- `packages/db-client/migrations/0039_pg026_scheduled_report_snapshots.sql` (**new**) + matching Drizzle schema additions (`trialBalanceSnapshots` in `accounting.ts`, `stockValuationSnapshots` in `inventory.ts`) — the two stubs whose own description said "compute **+ persist**" (trial-balance snapshot, stock-value report); every other stub either reminds (no persistence needed) or triggers a service's existing compute/reconcile logic.
- **Tests added:** `apps/scheduler-service/src/__tests__/system-jobs.test.ts` (**new**, 7 tests — registration + a representative sample across categories: fetch-based, direct-DB batched delete, direct-DB DDL, direct-DB read+notify), `apps/scheduler-service/src/__tests__/JobRegistry.test.ts` (**new**, 2 tests — the jobId-per-tenant fix).

## The 23 Stubs — What Each Now Does

| # | Job | Real work |
|---|---|---|
| 1 | `accounting.trial-balance.snapshot` | Calls new accounting-service route → `ReportsEngine.getTrialBalance` (already correct, JWT-only until now) → persists to new `trial_balance_snapshots` table |
| 2 | `accounting.outstanding-report` | Calls new report-service route → `ReportEngine`'s tested `ar-aging`/`ap-aging` queries → emails tenant contact a summary if either total > 0 |
| 3 | `accounting.bank-reconciliation-reminder` | Loops tenant's `bank_accounts`, sums `BankReconciliationService.getSummary`'s unmatched counts, emails a reminder if any account is unreconciled |
| 4 | `inventory.low-stock-alert` | Reuses `production.reorder-report`'s (now-fixed) underlying query — same comparison, no duplicated logic |
| 5 | `inventory.stock-value-report` | Reuses `valuation.routes.ts`'s live valuation query, persists to new `stock_valuation_snapshots` table |
| 6 | `inventory.physical-verification-reminder` | Unconditional monthly reminder (no "next due" concept exists in this schema — noted, not invented) |
| 7 | `gst.gstr1-auto-prepare` | Calls `Gstr1Service.compute` + `validateBeforeExport` for the previous period, audit-logs `GSTR1_AUTO_PREPARED` |
| 8 | `gst.gstr3b-reminder` | Unconditional monthly reminder (no filed/status flag exists in this schema either) |
| 9 | `gst.gstr2a-reconcile` | Actually calls `Gstr2aService.reconcile()` (not just the read-only summary getter), then reports the resulting summary |
| 10 | `hr.payroll.prepare` | Find-or-create this month's `payroll_runs` row, runs the same calculate loop `/payroll-runs/:id/calculate` uses |
| 11 | `hr.salary-slip.email` | Same publish-then-mark-sent logic as `/bulk-send`, scoped to slips not yet sent (idempotent across cron runs) |
| 12 | `sales.credit-limit-review` | New query: customers with `creditLimitEnabled` whose `projection_customer_balance` ≥ 90% of limit; emails a summary |
| 13 | `purchase.po-delivery-reminder` | Reuses `PurchaseOrderService.getPendingDelivery`, emails each supplier with an email on file |
| 14 | `purchase.pending-grn-alert` | New query: GRNs in `DRAFT`/`PENDING_APPROVAL` older than `GRN_PENDING_ALERT_DAYS` (default 3) |
| 15 | `workflow.approval-expiry` | Real escalation: reassigns to `workflowDefinitions.escalationUserId` if configured, else marks `EXPIRED` — see caveat below |
| 16 | `workflow.approval-reminder` | Increments `reminderCount`/`notifiedAt` on pending approvals — see caveat below |
| 17 | `platform.outbox-cleanup` | Batched `DELETE` of published outbox events > 7 days old |
| 18 | `platform.audit-log-archive` | Batched export-to-S3 (via `StorageClient`) + delete for audit log rows > 1 year old — archives, doesn't silently delete |
| 19 | `platform.token-cleanup` | Batched `DELETE` of expired refresh/password-reset tokens |
| 20 | `platform.partition-maintenance` | Real `CREATE TABLE IF NOT EXISTS ... PARTITION OF financial_entries` for next year |
| 21 | `platform.import-cleanup` | Deletes S3 files + tracking rows for completed/failed/rolled-back imports > 30 days old |
| 22 | `platform.notification-log-archive` | Same archive-then-delete pattern as audit-log-archive, for entries > 90 days old |
| 23 | `platform.export-cleanup` | Deletes S3 files for expired signed-URL exports, marks rows `EXPIRED` |

**Caveat on #15/#16 (workflow jobs):** see "Deep bug found, not fixed" below — both do real, honest bookkeeping against the schema as it actually behaves, but can't deliver an actual notification to a specific person today.

## Deep Bug Found, Not Fixed: `workflowApprovals.approverId` Is Actually a Role ID

`WorkflowEngine.resolveApprover()` (`packages/platform-sdk/src/workflow.ts`) resolves a `ROLE`-type approver to **the role's own id**, not a real user's id — its own comment says "simplified for Phase 1." That id is then stored in `workflowApprovals.approverId` and later compared against a real `userId` in `getPendingForApprover(userId)`. This means "pending approvals for me" has likely never matched real rows for any role-based approval (the large majority — 18 of `SYSTEM_WORKFLOW_DEFINITIONS`' 19 entries use `approverType: 'ROLE'`).

This is a separate, pre-existing, and significantly larger bug than PG-026's scope — properly fixing it means building role→user(s) resolution (a role can have zero, one, or many users) and deciding multi-approver semantics, not a one-line fix. **Not attempted here.** `workflow.approval-expiry`/`workflow.approval-reminder` were implemented to do real, correct work against the schema exactly as it exists today (reassignment on escalation, reminder-count bookkeeping) without pretending to resolve or notify a specific person, since doing so today would be silently wrong. Flagging this prominently as a recommended follow-up package.

## Bonus Fixes (found during PG-026, user explicitly approved fixing all of them mid-session)

1. **Two "already real" jobs were actually broken.** `production.reorder-report` and `production.job-work-overdue-alert` called JWT-only routes (`reorder.routes.ts`, `job-work.routes.ts` — both wrapped in `fastify.addHook('preHandler', authenticate)`) with only an `x-internal-key` header and no Bearer token — every call 401'd. Neither job checked `res.ok` before `res.json()`, so the error body's missing `.data` silently resolved to a count of **0 items** every single day instead of surfacing the failure — false confidence, exactly what this gap-prompt's own business objective warns about, but in a job the audit had marked "genuinely real." Fixed by adding internal-key-guarded equivalents (`apps/production-service/src/api/internal.routes.ts`, new file) and repointing both jobs at them; both are now `tenantScoped: true` (they weren't before, so they'd never have had a real tenant to query with anyway).

2. **Nine places across the codebase called notification-service at the wrong URL.** notification-service registers all its routes with **no prefix** (`await notificationRoutes(fastify, db, config)` directly on the root `fastify`), but 9 call sites used `/api/v2/notifications/...`. Every one 404's silently (wrapped in try/catch treated as best-effort). Found while implementing the reminder-type stubs above (which needed the correct pattern) and while researching hr-service for #10/#11. Fixed all 9:
   - `sales-service/api/internal.routes.ts` (×2), `hr-service/api/alteration.routes.ts` — found and fixed first, as they were directly in files this package was already touching.
   - `sales-service/domain/CampaignService.ts`, `sales-service/api/pos.routes.ts`, `sales-service/domain/InvoiceNotificationService.ts`, `auth-service/routes/forgot-password.ts` — same 1-line URL fix; `auth-service/__tests__/forgot-password.test.ts` also updated (it asserted the *broken* URL as correct).
   - `tenant-service/domain/TenantProvisioner.ts`'s `sendWelcomeEmail` — this one was broken in **three** ways, not one: wrong URL, a request body shape (`templateKey`/`recipient`/`variables`) matching no real endpoint's schema, and no `x-internal-key` header at all. Rewrote it to call `/notifications/send-internal` with the real `InternalSendSchema` shape, and added a `POST /notifications/templates/seed-tenant` route (`notification-service/api/notification.routes.ts`, new — mirrors the existing `seed-hr`/`seed-crm`/`seed-auth` convention) seeding a `WELCOME_EMAIL` template, since none existed anywhere and the notification would have silently no-op'd (per `[[pg017_password_reset_email_delivery]]`'s established no-template-row-found gap) even with a correctly-shaped call.
   - **Net effect:** password-reset emails, invoice-confirmation emails, POS receipts, CRM campaign dispatch, and tenant welcome emails were all silently non-functional before this session.

## Design notes / judgment calls

- **Platform-maintenance and workflow jobs (#15-23) run directly against `@erp/db`/`StorageClient`** in scheduler-service itself, per the gap-prompt's own suggested architecture — there's no single owning business service for cross-cutting maintenance.
- **Batching:** `deleteBatched()` caps any one run at `MAX_BATCHES_PER_RUN` (10) × `DELETE_BATCH_SIZE` (5000) = 50,000 rows, so a large backlog drains over several days rather than one run holding a long lock.
- **Archive means archive:** audit-log and notification-log entries are uploaded to S3 (`StorageClient.uploadFile`) before the matching rows are deleted — not a silent `DELETE`, per the gap-prompt's own security note about audit compliance retention.
- **`platform.partition-maintenance`** uses Postgres's documented safe pattern (`CREATE TABLE IF NOT EXISTS ... PARTITION OF ... FOR VALUES FROM/TO`), which doesn't lock concurrent writes to other partitions; idempotent via `IF NOT EXISTS`.
- **Reminder-type stubs with no "due" concept in the schema** (physical-verification, GSTR-3B filing) are unconditional on their cron cadence rather than invented — noted explicitly rather than fabricating a due-date heuristic the schema doesn't support.

## Tests Added + Results

- `apps/scheduler-service/src/__tests__/system-jobs.test.ts` — **7/7 passing.** Covers: all 23 jobs still register; a fetch-based job's `tenantId === undefined` guard and correct URL; a fetch-failure-doesn't-throw case; batched-delete stopping once a batch is short; the partition-maintenance DDL call; workflow-reminder bookkeeping; workflow-expiry's no-escalation-target path.
- `apps/scheduler-service/src/__tests__/JobRegistry.test.ts` — **2/2 passing.** Confirms `schedule()` produces a distinct `jobId` per tenant, and the bare name for non-tenant-scoped jobs.
- Full `apps/scheduler-service` suite: **54/54 passing** (45 pre-existing + 9 new), confirming no regression from the `registerSystemJobs`/`schedule()` signature changes.
- `tsc --noEmit` clean on all 12 touched services (accounting, report, inventory, production, gst, hr, sales, purchase, tenant, notification, auth, scheduler).
- Full test suites re-run for every touched service: sales-service (63/63), tenant-service (20/20), gst-service (23/23), purchase-service (25/25), inventory-service (22/22), accounting-service (17/17), report-service (118/118), production-service (5/5), auth-service's `forgot-password.test.ts` (2/2) — all passing, no regressions.
- **One pre-existing, unrelated failure found:** hr-service's `holiday.test.ts` (2 tests, 500 errors) — confirmed via `git status` that neither `holiday.routes.ts` nor its test were touched this session; the only other hr-service file with pending changes is `PayrollEngine.ts`, modified by a concurrent session outside this one's scope (per `[[concurrent_sessions_on_same_repo]]`). All payroll-specific tests (`payroll-encryption.test.ts`, `payroll-guard.test.ts`) pass cleanly, confirming this session's payroll changes aren't the cause.
- **Not run — no live Docker/Postgres/Redis this session:** `JobRegistry.triggerManual(name, tenantId)` end-to-end verification against a real database, for any of the 23 converted jobs. Everything above is unit-tested with mocked `fetch`/DB, not live-triggered.

## Deployment Checklist

- [ ] **Apply migration 0039** (`psql $DATABASE_URL < packages/db-client/migrations/0039_pg026_scheduled_report_snapshots.sql`) — creates `trial_balance_snapshots` and `stock_valuation_snapshots`. Not run this session (no live DB).
- [ ] **Manually trigger a sample of the 23 converted jobs** via `JobRegistry.triggerManual(name, tenantId)` against a real environment with real data, per this gap-prompt's own acceptance criteria — this session verified logic via mocked unit tests only, not live execution.
- [ ] **Set `GRN_PENDING_ALERT_DAYS`** and **`CREDIT_LIMIT_REVIEW_THRESHOLD`** env vars if the defaults (3 days, 0.9) aren't right for production — both are optional with sane defaults, no action required if defaults are acceptable.
- [ ] **Follow up on the `workflowApprovals.approverId`-is-a-role-id bug** (see dedicated section above) — a real, separate, larger fix needed before "pending approvals for me" or any per-approver notification can be trusted.
- [ ] **Confirm the 9 fixed notification-URL call sites** actually deliver in a live environment (password reset, invoice confirmation, POS receipts, campaign dispatch, tenant welcome email) — all were silently broken before this session; this fix was verified by code/test only, not a live send.

## Phases Unblocked

None directly (`Depends on: none`, `Blocks: none` per the originating brief). The workflow-engine role-resolution bug discovered here is a strong candidate for its own dedicated gap-prompt.
