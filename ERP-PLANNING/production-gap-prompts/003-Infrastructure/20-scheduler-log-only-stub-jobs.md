# [PG-026] Scheduler Log-Only Stub Jobs — Real Implementations

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Infrastructure
**Priority:** High
**Complexity:** M — no new architecture; each stub needs its real business logic implemented or wired to an existing real implementation elsewhere, but there are ~21 of them, which is the bulk of the effort.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `apps/scheduler-service/src/jobs/system-jobs.ts`, `apps/accounting-service`, `apps/report-service`, `apps/gst-service`, `apps/hr-service`, `apps/sales-service`, `apps/purchase-service`

---

## Overview

- **Business objective:** A scheduler job that's registered, running on schedule, and logging "Running trial balance snapshot" every night at 1 AM — without ever actually computing or storing a trial balance — is worse than not having the job at all, because its presence in logs/dashboards creates false confidence that the feature works. Tenants relying on daily outstanding-receivables reports, weekly credit-limit reviews, or nightly trial-balance snapshots are getting nothing, silently.
- **Current implementation — precise inventory, verified against the actual file:** `apps/scheduler-service/src/jobs/system-jobs.ts`'s `registerSystemJobs()` registers **44 jobs** via `registry.register(name, config, handler)` (not "31" as commonly cited elsewhere in this planning tree — worth flagging: the "31 registered jobs" figure repeated in prior planning docs and the environment brief for this session is **stale**; the real, current count in this file is 44). Of those 44, **21 are log-only stubs** — their entire handler body is a single `logger.info({...}, '<message>')` call with no real computation, no DB read/write, no downstream service call:

  | # | Job name | Cron | Real work needed |
  |---|---|---|---|
  | 1 | `accounting.trial-balance.snapshot` | `0 1 * * *` | Compute + persist a daily trial balance per tenant |
  | 2 | `accounting.outstanding-report` | `0 2 * * *` | Generate AR/AP outstanding report per tenant |
  | 3 | `accounting.bank-reconciliation-reminder` | `0 9 * * 1` | Send actual reminder notification |
  | 4 | `inventory.low-stock-alert` | `0 8 * * *` | Query items below reorder level, alert |
  | 5 | `inventory.stock-value-report` | `0 6 * * *` | Compute + persist daily stock valuation |
  | 6 | `inventory.physical-verification-reminder` | `0 9 1 * *` | Send actual reminder notification |
  | 7 | `gst.gstr1-auto-prepare` | `0 0 5 * *` | Trigger real GSTR-1 preparation |
  | 8 | `gst.gstr3b-reminder` | `0 9 10 * *` | Send actual reminder notification |
  | 9 | `gst.gstr2a-reconcile` | `0 3 * * 0` | Trigger real GSTR-2A reconciliation |
  | 10 | `hr.payroll.prepare` | `0 1 25 * *` | Trigger real payroll preparation |
  | 11 | `hr.salary-slip.email` | `0 9 28 * *` | Trigger real salary-slip email dispatch |
  | 12 | `sales.credit-limit-review` | `0 2 * * 0` | Compute + report customers over/near credit limit |
  | 13 | `purchase.po-delivery-reminder` | `0 9 * * *` | Send actual reminder to suppliers |
  | 14 | `purchase.pending-grn-alert` | `0 10 * * *` | Query pending GRNs, alert |
  | 15 | `workflow.approval-expiry` | `*/30 * * * *` | Has a comment (`// Actual escalation logic here using WorkflowEngine`) confirming it's a known placeholder — implement the escalation |
  | 16 | `workflow.approval-reminder` | `0 9,14 * * *` | Send actual reminder for pending approvals |
  | 17 | `platform.outbox-cleanup` | `0 4 * * *` | Actually delete/archive published outbox events older than 7 days |
  | 18 | `platform.audit-log-archive` | `0 5 1 * *` | Actually archive audit logs older than 1 year |
  | 19 | `platform.token-cleanup` | `0 3 * * *` | Actually delete expired refresh/reset tokens |
  | 20 | `platform.partition-maintenance` | `0 2 1 12 *` | Actually create next-year table partitions |
  | 21 | `platform.import-cleanup` | `0 6 * * *` | Actually clean failed/old import jobs + S3 files |
  | 22 | `platform.notification-log-archive` | `0 4 1 * *` | Actually archive notification log entries older than 90 days |
  | 23 | `platform.export-cleanup` | `0 5 * * *` | Actually clean expired export files + signed URLs |

  This corrects and expands the originating brief's three named examples (trial-balance snapshot, outstanding report, credit-limit review — all three confirmed real stubs, rows 1, 2, 12 above) — the actual stub population is **23 jobs, not 3**, spanning accounting, inventory, GST, HR, sales, purchase, workflow, and platform-maintenance categories.

  **The other 21 jobs are genuinely real**, not stubs — verified by reading their handler bodies: `inventory.reservation-expiry`, `inventory.nightly-reconciliation`, `gst.e-invoice-retry`, `gst.eway-bill-expiry-alert`, `hr.attendance.biometric-auto-import`, `hr.leave.accrual`, `hr.leave.year-end-carry-forward`, `hr.alteration.promised-today-alert`, `hr.alteration.overdue-alert`, `sales.quotation-expiry`, `sales.loyalty-points-expiry`, `sales.overdue-invoice-update`, `sales.overdue-payment-reminder`, `crm.customer-health-score`, `crm.birthday-anniversary-trigger`, `crm.campaign-dispatch`, `purchase.pdc-alert`, `search.full-reindex`, `search.incremental-sync`, `production.reorder-report`, `production.job-work-overdue-alert` — each makes a real HTTP call to its owning service's real endpoint and processes/logs the actual response body (e.g. `expiredCount`, `mismatches`, `retried`/`succeeded`). This package must not re-implement these; they are the pattern to copy for the 23 real stubs above.
  (Note: `hr.attendance.biometric-auto-import`'s scheduler-side call is real, but the HR endpoint it calls — `/api/v2/attendance/biometric-auto-import` — is itself documented elsewhere as a no-op stub per FEATURE_INVENTORY §8; that endpoint-level gap is PG-041's scope, not this package's — don't duplicate it here.)
- **Current architecture:** `JobRegistry` (`apps/scheduler-service/src/JobRegistry.ts`) wraps each registered job in a BullMQ `Queue`+`Worker` pair with a Redis-backed distributed lock (`erp:scheduler:lock:<name>:<tenantId>`, 300s TTL, `SET NX EX`) preventing duplicate execution across scheduler-service pods, 3 retry attempts with exponential backoff, and `removeOnComplete`/`removeOnFail` history caps. This infrastructure is solid and already correctly used by both the real and stub jobs alike — the gap is purely inside each stub's `handler` function body, not in the scheduling/locking mechanism around it.
- **Current limitations:** Exactly as inventoried above — 23 handlers that are `async (_job, tenantId) => { logger.info(...); }` and nothing else.

## Existing Code Analysis

- **What already exists and should be reused, per stub:**
  - **`accounting.trial-balance.snapshot`** — reuse `apps/accounting-service/src/api/reports.routes.ts`'s existing trial-balance endpoint logic, or `apps/report-service/src/domain/ReportEngine.ts`/`ReportRegistry.ts` (per project memory, report-service has its own separate P&L/BS/TB/CashFlow implementation, split from accounting-service's — verify which one is the canonical, correct implementation before choosing; per `[[report_service_reportengine_split]]`, report-service's had broken columns until ES-17 — confirm ES-17's fix landed and report-service's TB output is now trustworthy before wiring the scheduler job to call it over accounting-service's own route). The job should call the real endpoint via HTTP (same pattern as `inventory.reservation-expiry`'s `fetch(...)` call), not duplicate the calculation logic inside `scheduler-service`.
  - **`accounting.outstanding-report`** — reuse `apps/report-service/src/domain/ReportEngine.ts`'s AR/AP aging logic (confirmed real, tested — `ar-aging.test.ts`/`ap-aging.test.ts` exist in `apps/report-service/src/__tests__/`), called via the report-service's outstanding/aging endpoint.
  - **`sales.credit-limit-review`** — reuse the existing `creditLimit` field/check already present in `apps/sales-service/src/domain/InvoiceService.ts` (which enforces credit limit at invoice-creation time) — the scheduler job should call a new or existing sales-service report endpoint that surfaces customers currently over/near their limit, following the exact call pattern already used by the real `sales.*` jobs in the same file (e.g. `sales.overdue-invoice-update`'s `fetch(${salesUrl}/api/v2/invoices/mark-overdue, ...)`).
  - **`platform.outbox-cleanup`** — the `outbox_events` table and its lifecycle are owned by `event-service`'s outbox-relay worker (per `[[architecture_no_cross_service_valuation]]`/ES-02 audit context) — reuse whatever "mark relayed" state already exists there; this job should call an event-service endpoint (or, if none exists yet, a small new one) to actually delete/archive rows older than 7 days with `status = 'RELAYED'`, not invent a parallel outbox-cleanup mechanism inside scheduler-service.
  - **`platform.token-cleanup`** — reuse auth-service's existing refresh-token/password-reset-token tables and any existing repository method for expiring tokens; call auth-service's internal API the same way `gst.e-invoice-retry` calls gst-service.
  - **The 21 already-real jobs' `fetch(...)`-to-owning-service pattern** (with `x-internal-key` header, `INTERNAL_API_KEY` env var, wrapped in `try/catch` logging `.warn` on failure as "non-fatal") — this exact pattern is the template every stub-to-real conversion should follow, for consistency and because it's already proven correct (circuit-breaker wrapping is even present for the two inventory-service calls via `createCircuitBreaker` from `@erp/sdk` — consider applying the same circuit-breaker wrapper to any new cross-service call this package adds, matching the existing precedent rather than leaving new calls unprotected).
- **What should never be modified:** `JobRegistry.ts`'s locking/retry/scheduling mechanics — this package only fills in handler bodies and, where needed, adds new owning-service endpoints for the handlers to call; it does not touch the registry framework itself.
- **Prior related work:** `ES-16` is referenced in a comment in `system-jobs.ts` regarding the two real inventory HTTP calls and their circuit-breaker wrapping — read `ERP-PLANNING/phase-completions/ES-16_COMPLETION.md` if it exists, for the established convention on wrapping cross-service scheduler calls. `[[report_service_reportengine_split]]` (project memory) is directly relevant to the trial-balance/outstanding-report stubs — re-verify report-service's current correctness before trusting it as the reuse target, since the memory itself flags it as having had "broken columns until ES-17, some cases (day-book etc.) still broken."

## Architecture

- No new architectural pattern. For each of the 23 stubs, the correct shape is one of two things:
  1. **The owning service already has a real implementation of the underlying computation, just not exposed as (or not yet called from) a scheduler-triggered endpoint** — add a thin internal endpoint (`x-internal-key`-guarded, matching the existing convention) if one doesn't exist, and change the scheduler handler from a bare `logger.info` to a `fetch(...)` call against it, following the exact pattern of the 21 already-real jobs in the same file.
  2. **No real implementation exists anywhere yet** (verify per-stub — some of these, like `platform.partition-maintenance`, may have zero prior implementation anywhere in the codebase) — implement the real logic in the owning service first (as a normal backend feature, following that service's existing conventions), then wire the scheduler job to call it, same as case 1.
- Group the 23 stubs by owning service so this package can be worked service-by-service rather than job-by-job, since several stubs in the same service likely share setup/query patterns:
  - accounting-service: #1, #2, #3 (trial-balance, outstanding, bank-recon reminder)
  - inventory (via production-service or inventory-service, per this repo's cross-service split — verify which service owns `/api/v2/inventory/*` internal routes, likely inventory-service): #4, #5, #6
  - gst-service: #7, #8, #9
  - hr-service: #10, #11
  - sales-service: #12
  - purchase-service: #13, #14
  - scheduler-service itself (workflow/platform maintenance jobs, since these are cross-cutting DB-maintenance tasks with no obvious single "owning" business service — likely implemented directly against shared tables via `@erp/db`, not via an HTTP call to another service): #15, #16, #17, #18, #19, #20, #21, #22, #23

## Database Changes

- Not applicable for most reminder-type stubs (#3, #6, #8, #11, #13, #16 — these are read-then-notify, no schema change).
- Likely needed for the platform-maintenance stubs if not already present: verify whether `outbox_events`, `refresh_tokens`/`password_reset_tokens`, `audit_logs`, `notification_log`, and export-file-tracking tables already have the columns needed to identify "older than N days" / "status = X" rows (e.g. a `createdAt`/`relayedAt` timestamp) — these tables almost certainly already exist (referenced throughout the codebase per other completed phases); this package should not need new tables, only real query logic against existing ones. If a genuinely new table is needed (e.g. for `sales.credit-limit-review`'s output history, if that's wanted as a persisted report rather than a point-in-time notification), follow `packages/db-client`'s sequential migration numbering (next available is `0035_...`).
- Rollback strategy: any new migration should be a straightforward additive column/table, reversible by a corresponding down-migration per this repo's existing Drizzle migration convention.

## Backend

- Per stub, the concrete backend work is: implement or expose the real computation in its owning service (new or existing internal route, `requirePermission`/internal-API-key-guarded as appropriate for internal-only calls), then update the corresponding `registry.register(...)` handler in `system-jobs.ts` to call it — following the existing `fetch(url, { method, headers: { 'x-internal-key': apiKey } })` + `try/catch` + `logger.warn(..., 'non-fatal')` pattern used by all 21 real jobs today.
- For the platform-maintenance jobs (#17–23) that likely operate directly on shared tables rather than calling another service, implement the actual DB delete/archive/partition-create logic directly in the scheduler-service handler using `@erp/db`'s existing Drizzle client (scheduler-service already has DB access — see `main.ts`'s `createDatabaseClient` call) — this is consistent with how these jobs' names suggest cross-cutting maintenance rather than one business domain's concern.
- Reuse `createCircuitBreaker` (`@erp/sdk`) for any new cross-service HTTP call added, matching the existing precedent for the two inventory-service calls.
- Idempotency: several of these (outbox-cleanup, token-cleanup, audit-log-archive) are naturally idempotent (deleting already-deleted rows is a no-op); the reminder-type jobs (bank-reconciliation-reminder, PO-delivery-reminder, physical-verification-reminder) should guard against duplicate-reminder-per-period the same way the already-real `sales.overdue-payment-reminder`/`crm.birthday-anniversary-trigger` jobs presumably do (verify their dedup approach — likely a "last reminded at" timestamp check — and reuse the same approach for the new reminder stubs rather than inventing a different one).

## Frontend

Not applicable for most of these — backend/scheduler-only. If any (e.g. `sales.credit-limit-review`'s output) should surface in an existing admin/reports UI, that's additive to an already-existing page, not a new frontend surface — confirm during implementation whether such a page already exists before assuming one needs to be built.

## API Contract

- New internal endpoints as needed per stub (exact shape depends on what's already exposed per service — enumerate during implementation, not speculatively here). All internal (scheduler-to-service) calls follow the existing `x-internal-key` header convention already used by every real job in this file, not the public `requirePermission` JWT convention (these are service-to-service, not user-facing).

## Multi-Tenant Considerations

- Every stub already declares `tenantScoped: true` or `false` correctly in its `JobConfig` (verify this is accurate per job during implementation — e.g. `accounting.trial-balance.snapshot` is `tenantScoped: true`, meaning `JobRegistry` should already be invoking it once per tenant via `schedule(name, tenantId)` — confirm `main.ts`'s bootstrap loop (`for (const { name } of registry.listAll()) { await registry.schedule(name) }`) actually passes a `tenantId` for tenant-scoped jobs; reading `main.ts`, `registry.schedule(name)` is called **without** a `tenantId` argument for every job regardless of its `tenantScoped` flag — this looks like a **second, distinct bug** worth flagging and fixing in this same package: tenant-scoped jobs are registered with `tenantScoped: true` but the actual `schedule()` call in `main.ts` never iterates tenants or passes a tenant ID, meaning even a "real" tenant-scoped job would only ever run for `tenantId: undefined` today. This must be fixed (iterate all active tenants — likely via a call to tenant-service's tenant list — and call `schedule(name, tenantId)` per tenant for every `tenantScoped: true` job) as part of making these jobs actually work correctly, not just filling in their handler bodies.**
- All new/completed handlers must filter by `tenant_id` explicitly in any DB query they run (per this repo's standing multi-tenant convention — no RLS, app-code-enforced isolation).

## Integration

- **scheduler-service** — all handler-body changes land here.
- **accounting-service, report-service** — trial-balance/outstanding-report reuse or new internal endpoints.
- **gst-service** — GSTR-1 auto-prepare, GSTR-2A reconcile triggers.
- **hr-service** — payroll prepare, salary-slip email triggers.
- **sales-service** — credit-limit-review.
- **purchase-service** — PO-delivery-reminder, pending-GRN-alert.
- **event-service** — outbox-cleanup (if it calls out rather than querying the shared table directly).
- **auth-service** — token-cleanup (if it calls out rather than querying directly).
- **tenant-service** — needed to fix the tenant-iteration bug in `main.ts` for all `tenantScoped: true` jobs (get the active tenant list to loop over).

## Coding Standards

- Every stub-to-real conversion must follow the exact existing pattern in this same file: `fetch` with `x-internal-key`, `try/catch` wrapping with `logger.warn(..., 'non-fatal')` on failure (jobs should not throw and trigger BullMQ's retry/backoff for what are largely best-effort maintenance/notification tasks, matching the existing 21 real jobs' error-handling posture) — except where a job's own correctness genuinely requires a hard failure+retry (e.g., if outbox-cleanup deleting the wrong rows would be a data-integrity risk, prefer a conservative, testable query over a "log and swallow" one).
- `@erp/logger` for all logging (already the convention, continue it).
- No new job-registration mechanism — every change happens inside existing `registry.register(...)` calls' handler bodies, or as new internal routes in owning services following each service's existing Fastify+Zod route conventions.

## Performance

- Nightly/weekly cron jobs touching potentially large tables (audit-log-archive, outbox-cleanup, notification-log-archive) must batch/paginate deletes (e.g. `DELETE ... LIMIT 10000` in a loop, or partition-based archival) rather than a single unbounded `DELETE WHERE createdAt < ...` that could lock a large table for an extended period — this is a real risk given "35+ migrations" and presumably meaningful data volume by the time these jobs matter in production.
- `platform.partition-maintenance` (creating next-year partitions) is inherently a schema-DDL operation — ensure it runs in a way that doesn't lock concurrent writes to the current year's partition (standard Postgres partition-creation is normally safe/non-blocking if done correctly — verify the actual implementation follows Postgres's documented safe pattern for adding a new partition to an existing partitioned table).

## Security

- Internal endpoints these jobs call must be guarded the same way the 21 existing real jobs' target endpoints already are (verify each: `x-internal-key` checked server-side, not just sent client-side) — do not add a new internal endpoint that skips this check.
- Token-cleanup and audit-log-archive touch security-sensitive tables — ensure archival (not just deletion) is used where audit/compliance retention rules apply (per `platform.audit-log-archive`'s own naming — "archive," not "delete" — implement it as an actual move-to-cold-storage or a status-flag change, not a silent `DELETE`, since audit logs likely have compliance retention requirements this codebase's HR/GST modules already care about elsewhere).

## Testing

- Unit tests per converted stub, following this repo's existing scheduler-service test layout: extend `apps/scheduler-service/src/__tests__/` (e.g. a new `system-jobs.test.ts` if none exists, or extend the existing `search-sync-jobs.test.ts` pattern) — mock the owning service's HTTP response and assert the handler correctly parses/acts on it, mirroring how the real jobs' `fetch` calls would be tested.
- Integration test for the tenant-iteration bug fix in `main.ts` — assert that a `tenantScoped: true` job's `schedule()` call is actually invoked once per active tenant, not once with `tenantId: undefined`.
- For DB-maintenance jobs (outbox-cleanup, token-cleanup, etc.), add a test seeding old + recent rows and asserting only the old ones are removed/archived, with correct `tenant_id` scoping.

## Acceptance Criteria

- [ ] All 23 identified stub jobs have a real handler body — no remaining `async (_job, tenantId) => { logger.info(...); }`-only implementations among them.
- [ ] Each converted job either calls a real, tested endpoint in its owning service, or (for platform-maintenance jobs) performs real, tenant-scoped, batched DB operations directly.
- [ ] The `tenantScoped: true` jobs are verified to actually run once per active tenant (the `main.ts` `schedule()` tenant-iteration bug identified during this package's own investigation is fixed, not just noted).
- [ ] `pnpm --filter @erp/scheduler-service test` passes with new/updated tests covering the converted handlers.
- [ ] Manually triggering each converted job via `JobRegistry.triggerManual(name, tenantId)` produces the expected real side effect (verified against at least a sample of the 23, not just asserted by code review).
- [ ] Destructive/archival jobs (audit-log-archive, notification-log-archive, outbox-cleanup, token-cleanup) are confirmed to batch their operations and not lock large tables in a single unbounded statement.

## Deliverables

- **Files to create:** possibly a new `apps/scheduler-service/src/__tests__/system-jobs.test.ts`; any new internal route files in owning services (exact list depends on what each service is missing, enumerated during implementation).
- **Files to modify:** `apps/scheduler-service/src/jobs/system-jobs.ts` (23 handler bodies), `apps/scheduler-service/src/main.ts` (fix the tenant-iteration bug in the `schedule()` bootstrap loop), plus whichever owning-service route files need a new or extended internal endpoint (accounting-service, report-service, gst-service, hr-service, sales-service, purchase-service, event-service, auth-service — exact set determined per-stub during implementation).
- **Migrations:** none expected unless a stub genuinely requires new persisted state (e.g. a credit-limit-review history table) — use the next available number (`0035_...`) if so.
- **APIs added/changed:** new internal (`x-internal-key`-guarded) endpoints per owning service, as enumerated during implementation.
- **Events added/changed:** none expected — these are scheduled maintenance/report jobs, not new business events.
- **Tests added:** `system-jobs.test.ts` (or equivalent) covering all 23 converted handlers; a `main.ts` tenant-iteration test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/scheduler-service/src/JobRegistry.ts` provides a solid BullMQ + Redis-distributed-lock scheduling framework, and `apps/scheduler-service/src/jobs/system-jobs.ts` registers 44 jobs against it (not 31 — the "31" figure circulating in other planning docs is stale; re-count from the file directly). 21 of those 44 are genuinely real (they `fetch` their owning service's real endpoint and act on the response). The remaining 23 are log-only stubs spanning accounting, inventory, GST, HR, sales, purchase, workflow-approval, and platform-maintenance categories — see the full table in this file's Overview section for the exact list, cron schedules, and what real work each one needs.

**Current Objective:** Convert all 23 stub handlers to real implementations, reusing each owning service's existing logic where it already exists (e.g. report-service's AR/AP aging engine for `accounting.outstanding-report`) rather than reimplementing, following the exact `fetch`-with-`x-internal-key` pattern the 21 real jobs already establish. Also fix a second bug discovered during this package's own investigation: `main.ts`'s bootstrap loop calls `registry.schedule(name)` for every job without ever passing a `tenantId`, meaning `tenantScoped: true` jobs never actually iterate tenants today — this must be fixed alongside the stub conversions, since a "real" implementation that only ever runs for one undefined tenant is not actually fixed.

**Architecture Snapshot:**
1. `JobRegistry`'s locking/scheduling mechanics are correct and untouched by this package — only handler bodies (and the `main.ts` tenant-iteration bug) change.
2. The existing 21 real jobs are the template for style/error-handling (`fetch` + `x-internal-key` + `try/catch` + `logger.warn(..., 'non-fatal')`) — copy this pattern, don't invent a new one.
3. Some stubs (e.g. trial-balance, outstanding-report) have real logic already sitting in another service (report-service/accounting-service) — check there before writing new logic from scratch.
4. `report-service`'s ReportEngine has a documented history of correctness issues (per project memory, broken columns until ES-17, some cases like day-book allegedly still broken) — re-verify its current correctness before trusting it as the reuse target for the trial-balance/outstanding-report jobs, rather than assuming the memory note is stale.
5. Circuit-breaker wrapping (`createCircuitBreaker` from `@erp/sdk`) is already used for the two inventory-service calls — apply the same wrapper to any new cross-service call this package adds.

**Completed Components:** `JobRegistry` framework; the 21 already-real jobs (do not modify their handler bodies, only use them as a style reference).

**Pending Components:** All 23 stub-to-real conversions; the `main.ts` tenant-iteration bug fix; any new internal endpoints needed in owning services.

**Known Constraints:** No live DB/cluster guaranteed in every session — validate new handler logic with unit tests mocking the owning service's HTTP response where a live integration test isn't possible; flag clearly which conversions were only unit-tested vs. actually triggered end-to-end via `triggerManual`.

**Coding Standards:** Match the existing `fetch`/`x-internal-key`/`try-catch`/`logger.warn` pattern exactly; `@erp/logger` for all logging; no new job-registration mechanism.

**Reusable Components:** report-service's `ReportEngine`/`ReportRegistry` (trial balance, AR/AP aging); sales-service's existing `creditLimit` field/`InvoiceService` logic; the 21 real jobs' `fetch`+circuit-breaker pattern.

**APIs Already Available:** Whatever internal routes the 21 real jobs already call (e.g. `/api/v2/inventory/reservations/expire`, `/api/v2/gst/einvoice/retry-pending`) — as a reference for the shape new internal endpoints for the 23 stubs should take.

**Events Already Available:** Not directly relevant — these are scheduled jobs, not event-driven.

**Shared Utilities:** `@erp/sdk`'s `createCircuitBreaker`; `@erp/db`'s Drizzle client (already available in scheduler-service via `createDatabaseClient`).

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Every `tenantScoped: true` job must actually be invoked once per active tenant — this package must fix the `main.ts` bug where `schedule()` is called without a `tenantId` for any job today.

**Security Rules:** New internal endpoints must be `x-internal-key`-guarded server-side, matching existing convention; audit-log-archive must archive (not silently delete) per compliance-retention expectations already established elsewhere in this codebase (HR/GST modules).

**Database State:** Existing tables (`outbox_events`, token tables, `audit_logs`, notification log, export-file tracking) almost certainly already have the columns needed (timestamps, status) — verify before assuming a migration is needed; only add one if a genuine gap is found (next available migration number: `0035_...`).

**Testing Status:** No dedicated test file for `system-jobs.ts`'s handlers exists today (only `search-sync-jobs.test.ts` covers the two search jobs) — this package should add coverage for all 23 newly-real handlers.

**Next Session Plan:** Split by owning-service grouping (see Architecture section's grouping) across multiple sessions given ~23 conversions plus the `main.ts` bug fix — Session 1: accounting/report-service jobs (#1-3) + the tenant-iteration bug fix (highest business value, financial reporting). Session 2: inventory/GST/HR jobs (#4-11). Session 3: sales/purchase/workflow/platform-maintenance jobs (#12-23).

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/003-Infrastructure/20-scheduler-log-only-stub-jobs.md` and implement PG-026 (or its next session per the file's own split). Re-verify `apps/scheduler-service/src/jobs/system-jobs.ts` and `apps/scheduler-service/src/main.ts` first — this package's own investigation found 44 total registered jobs (not the commonly-cited 31), 23 of them log-only stubs, plus a distinct bug where tenant-scoped jobs never actually receive a `tenantId` when scheduled. Confirm both counts and the bug are still accurate before implementing, since concurrent sessions may have already touched this file."
