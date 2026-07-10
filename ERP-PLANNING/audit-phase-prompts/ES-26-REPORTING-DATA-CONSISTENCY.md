# ES-26 — Reporting, Notification & Scheduler Data Consistency
## STATUS: ✅ COMPLETE — see phase-completions/ES-26_COMPLETION.md
## Sprint: 6 | Effort: 3–4 days | Risk: Medium (wrong financial reports, duplicate notifications)
## Depends on: ES-17 (analytics/reporting) — this phase re-closes drift that reopened after ES-17
## Unlocks: nothing blocked on this
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings M5, M6, M7, M8, M9

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP, focused on
report-service, scheduler-service, and notification-service.

The 2026-07-03 architecture audit found that report-service's duplicate P&L implementation has
drifted from accounting-service's again (the exact class of bug ES-17 fixed once already), that
three report types still reference nonexistent database columns and will 500 at runtime, that a
performance report describes a cache that was never actually built, and that notification retries
can double-send under a specific failure timing. None of these are architecture-shaking, but they
are all real, user-visible bugs.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §4, findings M5–M9
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-17-ANALYTICS-REPORTING.md` and its completion
      report — the prior fix for the P&L column-name drift; understand what was fixed then so you
      don't regress it while fixing the new drift
- [ ] Read `apps/report-service/src/domain/ReportEngine.ts` in full — this is the file for almost
      everything in this phase. Note its size; work method-by-method
- [ ] Read `apps/accounting-service/src/domain/ReportsEngine.ts:243,247` (the CONTRA-account
      bucketing logic that report-service's copy is missing)
- [ ] Read `packages/db-client/src/schema/accounting.ts:176-199` — the real `financial_entries`
      schema (`created_at`, `debit_amount`, `credit_amount` — confirm there is genuinely no
      `entry_date`/`debit_credit`/`amount` column)
- [ ] Read `apps/report-service/src/__tests__/financial-reports.test.ts` — note it mocks `db.execute`
      and never hits real column names, which is why M5/M6 went undetected
- [ ] Read `apps/notification-service/src/domain/NotificationEngine.ts:208-248`
      (`deliverWithRetry`) and `apps/notification-service/src/api/notification.routes.ts:62-110`
- [ ] Read `ERP-PLANNING/phase-completions/chaos-engineering-report.md`, experiment 3.2 — the
      architecture it describes (BullMQ `notification_retry` job, 30s/2m/10m backoff) does not match
      current code; decide in this phase whether to build that architecture or correct the report
- [ ] Read `apps/scheduler-service/src/domain/ImportEngine.ts:200-216` (`execute`)
- [ ] Confirm report-service genuinely has no Redis dependency: check
      `apps/report-service/package.json` for `ioredis`
- [ ] Run `pnpm test --filter @erp/report-service --filter @erp/notification-service --filter
      @erp/scheduler-service` — confirm a clean baseline

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Why the duplicate P&L implementations keep drifting
`apps/report-service` and `apps/accounting-service` each have their own independent
P&L/Balance-Sheet/Trial-Balance/Cash-Flow query logic (an intentional architecture choice from
early phases to avoid a synchronous cross-service call on the hot report path — see project memory
`report_service_reportengine_split` if available to you). The cost of that choice is exactly what
you're fixing now: any bug fixed in one copy doesn't automatically apply to the other. This phase
does not consolidate them (that's a larger refactor decision for the team) — it just re-syncs them
and adds a regression test that would have caught the drift.

### Coding Standards
- TypeScript strict — no `any`
- Any test for `ReportEngine.ts` added in this phase must exercise real column names / real query
  logic, not a fully-mocked `db.execute` that would hide the exact class of bug this phase fixes —
  use a real (test) Postgres connection if the existing test infra supports it, matching whatever
  integration-test pattern other services use

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[M5]** Fix report-service's P&L CONTRA-account miscategorization
2. **[M6]** Fix the remaining broken report slugs (Day Book, Account Ledger, Bank Book, GST-payable,
   one fund-flow case) that reference nonexistent columns
3. **[M7]** Resolve the report-service Redis-cache documentation/reality mismatch
4. **[M8]** Fix notification retry semantics — move to a real job queue or add an idempotency key,
   and correct the chaos report if the architecture described there isn't what's built
5. **[M9]** Make `ImportEngine.execute()`'s status transition atomic

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — P&L CONTRA account fix [M5]

`apps/report-service/src/domain/ReportEngine.ts:1236-1242`: the `CASE` expression assigning each
account a P&L `category` has no branch for `a.account_type = 'CONTRA'`, so such accounts fall into
`ELSE 'OTHER'`. Add the missing branch, matching `apps/accounting-service/src/domain/
ReportsEngine.ts:243,247`'s logic exactly — CONTRA accounts should bucket into `contraRevenue` and
net against COGS the same way (`totalCogs = cogs + contraRevenue`).

Add a test case to `apps/report-service/src/__tests__/financial-reports.test.ts` that exercises a
CONTRA-type account row and asserts the resulting Net Profit total matches what
`accounting-service`'s implementation would produce for the same input data — this is the
regression test that would have caught this the first time.

### Step 2 — Broken report columns [M6]

`apps/report-service/src/domain/ReportEngine.ts`, cases `day-book` (~line 1133), `account-ledger`
(~line 1152), `bank-book` (~line 1363), the GST-payable case (~line 1343), and the fund-flow-style
case (~line 1469): all reference `fe.entry_date`, `fe.debit_credit`, `fe.amount`, none of which
exist on `financial_entries`. Apply the same column mapping ES-17 already used for P&L/BS/TB/CF:
`created_at` for `entry_date`, and split `debit_amount`/`credit_amount` (compute `debit_credit`
sign and `amount` from whichever of the two is nonzero, matching how the already-fixed reports
handle it — read their query logic in this same file for the exact pattern to copy).

Add integration-style tests for these 5 report types (not fully mocked — see Project Context) that
would 500 immediately on the current broken code and pass once fixed.

### Step 3 — Redis cache doc/reality mismatch [M7]

Confirm `apps/report-service` has no `ioredis` dependency (per pre-flight). Decide and implement
ONE of:
- **(a)** Build the cache the query-optimization report describes: a 3-minute Redis cache on the
  GST-payable report query (and any other latency-sensitive report query worth caching — use
  `ctx.cache` from `PlatformContext`, tenant-namespaced, per the platform's mandatory pattern, not a
  raw Redis client).
- **(b)** Correct `ERP-PLANNING/phase-completions/query-optimization-report.md:171` to remove the
  false claim, and instead document the actual mitigating factor (e.g. low call volume, or note
  there is none).

Prefer (a) if GST-payable report query volume is meaningful (check `pg_stat_statements` data if
available, or the original query-optimization report's call-count column for this query) — a cache
is cheap to add and directly reduces DB load. If you can't verify volume, default to (a) anyway
since `ctx.cache` usage is low-risk and matches the architecture's intended pattern; only choose
(b) if there's a concrete reason not to cache (e.g. the report must always be real-time-accurate for
compliance reasons — check with GST-domain context in `ERP-PLANNING/audit-phase-prompts/
ES-10-GST-COMPLIANCE-CESS-RCM-GSTR9.md` before assuming caching is safe for this specific report).

### Step 4 — Notification retry semantics [M8]

Two acceptable resolutions — pick based on what's actually feasible in this phase's timebox:

**(a) Minimal fix (recommended for this phase):** keep the synchronous in-process retry in
`NotificationEngine.deliverWithRetry()`, but add an idempotency key check before sending: hash
`tenantId + eventType + recipient + templateDataHash + a time bucket` (e.g. 5-minute bucket) and
check/insert into `notification_log` with a unique constraint on that hash before dispatching. A
retry (from the caller's HTTP-level retry, not the internal backoff) that lands on an
already-recently-sent notification is then rejected/deduped rather than sending twice. Update
`chaos-engineering-report.md`'s experiment 3.2 description to match what's actually implemented
(synchronous retry + idempotency key, not a BullMQ job) — don't leave the doc describing a
mechanism that doesn't exist.

**(b) Full fix (larger scope, only if time allows):** move retry to a real BullMQ job in
scheduler-service (matching what the chaos report currently, incorrectly, describes as already
built), with the notification write happening synchronously (fast) and delivery happening async via
the job queue with real 30s/2m/10m backoff.

Whichever you choose, update `/notifications/send`, `/send-internal`, `/send-raw-internal`
(`apps/notification-service/src/api/notification.routes.ts:62-110`) to accept an optional
`idempotencyKey` from the caller in addition to (or instead of) the derived hash, for callers that
already have a natural dedup key (e.g. `sales-service`'s overdue-payment-reminder job, which fires
on a schedule and could pass `invoiceId+reminderDate` as the key).

### Step 5 — ImportEngine atomic status transition [M9]

`apps/scheduler-service/src/domain/ImportEngine.ts:200-216` (`execute`): replace the SELECT-then-
UPDATE status check with a single atomic `UPDATE import_jobs SET status = 'EXECUTING' WHERE id =
:jobId AND status = 'VALIDATED' RETURNING id`. If zero rows are returned, another call already
claimed this job — return/throw a clear "already executing or not in a runnable state" response
instead of proceeding.

### OUT OF SCOPE
- Consolidating report-service and accounting-service's duplicate report engines into one shared
  implementation
- A full BullMQ-based notification architecture unless you specifically choose Step 4's option (b)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

1. P&L report with a CONTRA account produces the same Net Profit as accounting-service's
   implementation for identical input data
2. Day Book, Account Ledger, Bank Book, GST-payable, and the fund-flow report all execute against
   real (or realistically-schemad test) data without a column-not-found error
3. If Step 3 chose (a): a cached GST-payable report call within the cache TTL doesn't re-query
   Postgres (assert via query-count spy/mock)
4. Two rapid-fire calls to `/notifications/send` with the same idempotency key (or same derived
   hash within the time bucket) result in exactly one actual send
5. Two concurrent `ImportEngine.execute()` calls for the same job — assert only one proceeds to
   EXECUTING and performs the batch insert

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/report-service build
pnpm --filter @erp/notification-service build
pnpm --filter @erp/scheduler-service build
pnpm lint
pnpm type-check
pnpm test --filter @erp/report-service --filter @erp/notification-service --filter @erp/scheduler-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] P&L totals from report-service and accounting-service match for a dataset including CONTRA
      accounts
- [ ] Day Book / Account Ledger / Bank Book / GST-payable / fund-flow reports return data instead
      of 500ing
- [ ] The Redis-cache claim in `query-optimization-report.md` is either now true or corrected
- [ ] Duplicate notification sends within the idempotency window are prevented
- [ ] `chaos-engineering-report.md`'s experiment 3.2 description matches the actual implemented
      mechanism
- [ ] Concurrent `ImportEngine.execute()` calls can't double-process the same job

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] P&L, Balance Sheet, Trial Balance, Cash Flow reports (already fixed by ES-17) are unaffected
      by the CONTRA-account addition — re-run ES-17's original test cases
- [ ] Notifications that are genuinely NOT duplicates (different recipients, different content)
      still send normally
- [ ] `ImportEngine`'s existing validate-only flow and successful single-execution flow are
      unaffected

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] M5, M6, M7, M8, M9 all closed per the fixes above
- [ ] All new tests pass; ES-17's original test suite still passes
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-26_COMPLETION.md`
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` updated: mark M5, M6, M7, M8, M9 with current
      status and a pointer to the completion report

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-26_COMPLETION.md`

```markdown
# ES-26 Completion Report — Reporting, Notification & Scheduler Data Consistency
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| M5 | P&L CONTRA miscategorization | Added CONTRA branch matching accounting-service | cross-service parity test |
| M6 | Day Book/Ledger/Bank Book/GST-payable/fund-flow broken columns | Applied ES-17's column mapping | integration test |
| M7 | report-service cache claimed but absent | [built ctx.cache-based cache / corrected doc] | test or doc diff |
| M8 | Notification retry double-send risk | Idempotency key [+ BullMQ if chosen] | test |
| M9 | ImportEngine non-atomic status transition | Atomic UPDATE...WHERE...RETURNING | concurrency test |

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
[e.g. report-engine consolidation still not done — drift can reopen a third time without it]
```
