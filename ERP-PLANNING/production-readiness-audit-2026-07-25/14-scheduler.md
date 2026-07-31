# Scheduler Module — Production Readiness Audit (2026-07-25)

Scope: `apps/scheduler-service` (distributed cron/job scheduling, job history, retries) +
`apps/web-frontend/src/pages/admin/distributed/SchedulerJobsPage.tsx`.

All findings below are live-verified against the running stack (gateway :3000, scheduler-service
:3016, plus direct calls to accounting :3019, purchase :3020, inventory :3012, gst :3018,
notification :3014) unless explicitly marked as code-review-only.

## Summary

The scaffolding is genuinely solid: BullMQ-backed distributed locking, `job_history`
RUNNING→COMPLETED/FAILED/SKIPPED lifecycle recording, retry-with-backoff, Prometheus metrics,
and a fully-wired frontend all work exactly as the 2026-07-22 audit claimed. But this audit found
a much bigger, previously-undetected problem underneath that scaffolding: **28 of the service's
~46 HTTP-calling system jobs — spanning Accounting, Inventory, GST, HR, Sales, CRM, Purchase, and
Notifications — are silently non-functional on every single run**, because they send
`Content-Type: application/json` with no request body on a `fetch()` POST, which every
downstream Fastify service's default JSON parser rejects with `400 Bad Request`. Since these
handlers never check `res.ok` and only catch network-level exceptions, `job_history` and the
Scheduler Jobs dashboard both report `COMPLETED` with no error — a false-green status hiding a
100%-broken automation pipeline across most of the platform's scheduled business processes. This
is a variant of the CRITICAL CONTEXT concern (silent-failure, invisible to operators) but with
far larger blast radius than the Kafka-consumer pattern, and a different root cause. Separately,
the Kafka-consumer shared-transaction bug (from CRITICAL CONTEXT) is confirmed to also apply to
scheduler-service's own `usageEventConsumer`. A tenant-level OWNER can also trigger platform-wide,
cross-tenant maintenance jobs with no additional guard.

## What works (verified live)

- **54 jobs registered and visible** via `GET /jobs` (tenant-2 owner, `JOB_VIEW`), each with cron,
  description, pause state, and last-run summary.
- **job_history genuinely records real runs with real errors** for jobs that actually throw.
  Live-triggered `hr.payroll.prepare` (job id `1118`, manual, `triggeredByUserId: 2`) recorded
  `status: FAILED`, `errorMessage: "Payroll prepare failed: HTTP 400 {...}"` within 14ms —
  disproving that scheduler-service's _own_ job-execution wrapper (`JobRegistry.ts` lines 56–131,
  `startHistory`/`completeHistory`) has the shared-transaction blind spot described in the
  CRITICAL CONTEXT: it's a separate, non-transactional best-effort write, not coupled to the
  handler's own DB work.
- **Retry-with-backoff genuinely fires.** The pre-existing CRON run of `hr.payroll.prepare` shows
  3 recorded attempts (ids 465, 501, 508) at 19:30:00 / 19:30:05 / 19:30:15 — matching BullMQ's
  configured `attempts: 3, backoff: exponential(5000ms)` — before giving up for that cron tick.
- **Manual trigger works and attributes the triggering user correctly** (`POST
/jobs/:name/trigger` → `triggeredByUserId` populated from the JWT `sub`, verified on jobs 162
  and 153).
- **Distributed lock (`SET NX EX`) + SKIPPED status work**: `erp_job_execution_total{status="skipped"}`
  is non-zero for high-frequency jobs like `gst.e-invoice-retry` (39), `crm.campaign-dispatch` (58),
  `inventory.reservation-expiry` (20).
- **Prometheus `/metrics` is real and populated** — `erp_job_execution_total` broken down by
  `job_name`/`status` with realistic counts (e.g. `workflow.approval-expiry` completed=90,
  `gst.e-invoice-retry` completed=59), not an empty/stub endpoint.
- **RBAC is enforced per-route, not just per-page.** Platform operator (`operator@platform.local`,
  permissions `PLATFORM_TENANT_MANAGE`/`PLATFORM_CONTENT_MANAGE` only) got a real `403
PERMISSION_DENIED: Missing permission: JOB_VIEW` calling `GET /jobs` directly against
  scheduler-service.
- **SchedulerJobsPage.tsx is fully built and faithful to the backend**: job list with
  cron/description/pause badges, Trigger Now/Pause/Resume gated by `JOB_TRIGGER`/`JOB_PAUSE`,
  a history panel showing the last 30 runs with duration and error message. It correctly
  displayed `hr.payroll.prepare` as FAILED — the UI is not the bug, the data it's fed is.
- **Tests: 71/71 passing** across 11 files (`pnpm --filter @erp/scheduler-service test`).

## Bugs/gaps found

### CRITICAL — 28 scheduled jobs silently no-op on every run (Content-Type/empty-body bug)

Every affected job does something like:

```ts
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
  // no `body` field
});
const body = (await res.json()) as { data?: {...} };   // never checks res.ok
logger.info({ ...body.data }, 'X complete');            // logs undefined fields, looks fine
```

Fastify's default JSON body parser rejects a request that declares
`Content-Type: application/json` but sends a truly empty body, with `400 Bad Request` and message
`"Body cannot be empty when content-type is set to 'application/json'"`. Live-reproduced by
replaying the exact request scheduler-service sends against 5 different real services, 5/5 got
400:

```
POST /api/v2/internal/reports/trial-balance-snapshot?tenantId=2   (accounting:3019) → 400
POST /api/v2/purchase/pending-grn-alerts/run?tenantId=2           (purchase:3020)   → 400
POST /api/v2/internal/inventory/valuation-snapshot?tenantId=2     (inventory:3012)  → 400
POST /notifications/retry-failed-internal?tenantId=2              (notification:3014)→ 400
POST /api/v2/gst/gstr1/auto-prepare?tenantId=2                    (gst:3018)        → 400
```

Because the handlers only catch network-level exceptions (not non-2xx HTTP responses) and don't
rethrow, `JobRegistry`'s own failure-recording path never fires. Confirmed via live `job_history`
rows, all showing `status: COMPLETED, errorMessage: null` despite the underlying call 400ing every
time: `accounting.trial-balance.snapshot` (id 471), `inventory.stock-value-report` (id 244),
`purchase.pending-grn-alert` (id 242), `notification.retry-failed` (id 1112).

Programmatic scan of `apps/scheduler-service/src/jobs/system-jobs.ts` for the exact pattern (POST

- `Content-Type: application/json` header + no `body:` field) found **28 affected jobs**:
  `accounting.trial-balance.snapshot`, `accounting.depreciation.monthly-run`,
  `accounting.outstanding-report`, `accounting.bank-reconciliation-reminder`,
  `inventory.stock-value-report`, `inventory.physical-verification-reminder`,
  `gst.gstr1-auto-prepare`, `gst.gstr3b-reminder`, `gst.e-invoice-retry`,
  `gst.eway-bill-expiry-alert`, `gst.gstr2a-reconcile`, `hr.attendance.biometric-auto-import`,
  `hr.leave.accrual`, `hr.leave.year-end-carry-forward`, `hr.payroll.prepare`,
  `hr.salary-slip.email`, `sales.quotation-expiry`, `sales.loyalty-points-expiry`,
  `sales.overdue-invoice-update`, `sales.overdue-payment-reminder`, `sales.credit-limit-review`,
  `crm.customer-health-score`, `crm.birthday-anniversary-trigger`, `crm.campaign-dispatch`,
  `purchase.po-delivery-reminder`, `purchase.pending-grn-alert`, `purchase.pdc-alert`,
  `notification.retry-failed`. (Jobs using GET, or that pass a real `body:`, e.g.
  `inventory.low-stock-alert`, `workflow.approval-reminder`, `production.reorder-report`'s
  notify step, are unaffected.)

**Business impact**: trial balance snapshots, monthly depreciation, outstanding
receivables/payables reports, bank-reconciliation reminders, daily stock valuation, physical
verification reminders, GSTR-1 auto-prep, GSTR-3B reminders, e-Invoice PENDING_IRN retry, e-Way
Bill expiry alerts, GSTR-2A reconciliation, biometric attendance import, monthly leave accrual,
year-end leave carry-forward, quotation expiry, loyalty point expiry, overdue-invoice marking,
overdue-payment reminders, credit-limit review, customer health scoring, birthday/anniversary
greetings, campaign dispatch, PO delivery reminders, pending-GRN alerts, PDC alerts, and
failed-notification retry are **all silently doing nothing**, on every scheduled run, while the
Scheduler Jobs dashboard shows them green. This is a wider and more damaging version of the
CRITICAL CONTEXT concern — not a rare handler-throw edge case, but the default behavior of 61%
of the job fleet.

Two jobs — `hr.payroll.prepare` and `hr.salary-slip.email` — hit this exact same broken-fetch
pattern but were previously hardened (per an in-code comment referencing a 2026-07-23
notification-service audit) to check `res.ok` and rethrow, specifically so a downstream failure
would actually retry/surface instead of being swallowed. That fix works as intended — but nobody
fixed the underlying "no body" bug, so these two jobs now **fail loudly and correctly, 100% of
the time**. Live-reproduced twice, right now, via manual trigger:

- `hr.payroll.prepare` → job id 1118 → `FAILED`, `HTTP 400 Body cannot be empty...`
- `hr.salary-slip.email` → job id 1120 → `FAILED`, `HTTP 400 Body cannot be empty...`

Monthly payroll preparation (25th of month) and salary-slip email dispatch (28th of month) are
completely broken; every scheduled and manual run will fail. This is at least visible in
job_history/UI (unlike the 26 silent-COMPLETED cases above), but still a full automation outage.

**Severity: Critical.** Fix is small per-job (add `body: JSON.stringify({})` or drop the
Content-Type header on GET/bodyless calls) but touches ~28 call sites, and the systemic gap — no
`res.ok` check, no integration test that exercises a real body parser — should be closed once,
not per-job.

### HIGH — scheduler-service's own Kafka consumer shares the platform-wide silent-failure bug (code-reviewed, not live-reproduced)

`apps/scheduler-service/src/main.ts` wires a `PlatformEventConsumer` (`packages/platform-sdk/src/events.ts`)
subscribed to `erp.usage.invoice.created` / `erp.usage.api.call.batch`, handled by
`handleUsageEvent` in `jobs/usageEventConsumer.ts`. Reading `events.ts` lines 166–225: the inbox
claim (`INSERT ... ON CONFLICT` into `inboxEvents`) and `handler(event, trx)` run inside the same
`db.transaction`. If `handleUsageEvent` throws, the whole transaction — including the inbox claim
— rolls back. The `catch` block then issues `db.raw.update(inboxEvents).set({status:'FAILED'})...`,
but since the insert was rolled back, that row never existed to update — 0 rows affected, no
trace left anywhere (no `inboxEvents` row, no DLQ entry). This is exactly the pattern flagged in
CRITICAL CONTEXT, and it is confirmed (by direct code inspection, matching the Accounting audit's
finding) to apply to scheduler-service's own usage-event consumption path, not just its cron jobs.
Not live-reproduced this session (would require publishing a malformed Kafka event to force
`handleUsageEvent` to throw); flagged as high-confidence from code review.

### HIGH — tenant-level users can trigger platform-wide, cross-tenant maintenance jobs

`POST /jobs/:name/trigger` (`apps/scheduler-service/src/api/scheduler.routes.ts`) only checks the
granular `JOB_TRIGGER` permission; it never checks `config.tenantScoped` or restricts non-tenant
(`platform.*`) jobs to a platform-operator-level role. Live-confirmed: logged in as tenant-2
OWNER (not platform operator), successfully triggered:

- `platform.token-cleanup` (deletes expired refresh/reset tokens for **all** tenants) → `200`
- `platform.partition-maintenance` (issues `CREATE TABLE ... PARTITION OF` on the shared
  `financial_entries` table) → `200`

Any tenant role holding `JOB_TRIGGER` (OWNER confirmed, likely ADMIN too) can fire jobs that
operate platform-wide, and could repeatedly trigger heavier ones (e.g.
`platform.audit-log-archive`, which does a real MinIO upload + batched delete loop) as a DoS
vector against the whole platform, not just their own tenant.

### MEDIUM — orphaned job_history row stuck in RUNNING for 8 days

`search.full-reindex` history shows a row with `status: RUNNING`, `triggeredBy: MANUAL`,
`startedAt: 2026-07-17T14:23:45.117Z` — 8 days old at time of audit, with no newer row for that
job. There is no reconciliation/timeout sweep that detects a stale RUNNING row (e.g. left behind
by a service restart mid-job, since the lock TTL is 300s but nothing revisits the history row
after the lock expires) and marks it FAILED/UNKNOWN. This pollutes "last run" status on the Jobs
list — an operator glancing at the dashboard would see a job that looks perpetually "in progress."

### MEDIUM — test suite structurally cannot catch the Content-Type/body bug class

`apps/scheduler-service/src/__tests__/system-jobs.test.ts` mocks `global.fetch` entirely via a
`jsonResponse()` helper that defaults to `ok: true, status: 200` and never round-trips through a
real Fastify body parser. None of the 71 passing tests exercise an actual HTTP call to a real
service, so the CRITICAL finding above would never surface in CI — only live/integration testing
against the real stack (as done in this audit) can catch it. Worth flagging as a systemic test
gap, not just a code gap.

### LOW — report-service's scheduled reports are completely invisible to scheduler-service

Cross-checked task #7 (report schedule id 9, "sales-register weekly" from the sibling Reports
audit): `report-service` runs its **own independent** in-process cron system
(`apps/report-service/src/scheduler/ScheduledReportJob.ts`, using the `croner` library, its own
Redis lock keyed `erp:report-schedule:lock:*`, and its own `reportRunHistory` table) — completely
unrelated to scheduler-service's `JobRegistry`/`job_history`/BullMQ. Grepping scheduler-service's
source confirms zero references to `reportSchedules` or any report-schedule concept. The
"sales-register weekly" schedule will **never** appear in `GET /jobs` or
`/jobs/:name/history` on scheduler-service, and `SchedulerJobsPage.tsx` gives operators zero
visibility into report-schedule health or failures — two independent, unlinked scheduling systems
exist side by side with no shared observability.

## Untested/unknown areas

- Did not force-kill scheduler-service mid-job to reproduce the RUNNING-orphan mechanism directly
  beyond the one pre-existing stale row observed.
- Did not publish a live malformed Kafka event to force `handleUsageEvent` to throw and directly
  confirm the inbox-events silent-failure for scheduler-service's own consumer (HIGH finding #2
  is code-review-confirmed, not live-reproduced).
- Could not test true multi-tenant job-history isolation with a second live tenant — only tenant 2
  and the cross-tenant platform operator were available (tenant 1 is stale/nonexistent per
  TEST_CREDENTIALS.md).
- Did not individually audit the remaining ~18 non-affected jobs (GET-based or DB-direct, e.g.
  `platform.outbox-cleanup`, `platform.audit-log-archive`, `workflow.*`) for other latent bugs
  beyond the ones sampled/read in full.
- Did not verify DLQ dashboard/alerting wiring specifically for scheduler-service's Kafka topics.

## Test data created this session

- `hr.payroll.prepare` manual trigger → job_history id 1118 (FAILED, tenant 2)
- `hr.salary-slip.email` manual trigger → job_history id 1120 (FAILED, tenant 2)
- `platform.token-cleanup` manual trigger → queued as job id 110 (platform-wide side effect —
  deletes expired tokens across all tenants; idempotent/harmless since it only touches already-
  expired rows)
- `platform.partition-maintenance` manual trigger → queued as job id 81 (idempotent —
  `CREATE TABLE IF NOT EXISTS` for next year's `financial_entries` partition; harmless if it
  already exists or gets created)

No code was modified. No destructive test data was created — all triggers hit read-mostly or
already-idempotent maintenance jobs.

## Readiness score: 35/100

The distributed-scheduling _infrastructure_ (BullMQ, locking, retry, job_history schema,
Prometheus metrics, RBAC-gated frontend) is well-built and behaves exactly as designed — that
alone would justify a 70+ score. But infrastructure quality isn't what "production readiness"
means for a scheduler: it means the jobs it runs actually do their job. Live testing found that
**61% of the registered HTTP-calling jobs (28/46) silently do nothing on every run**, and the
dashboard built to surface exactly this kind of problem instead reports them all green — which is
arguably worse than having no monitoring at all, since it actively suppresses the alarm. Combined
with a confirmed cross-tenant privilege gap (platform-wide job triggering from tenant-level roles)
and the code-confirmed shared-transaction Kafka blind spot, this module is not production-ready:
a real deployment today would have GST filing prep, payroll, depreciation, stock valuation,
customer-facing reminders, and loyalty/credit sweeps all quietly not running, discovered only when
a human notices the downstream business process itself never happened.
