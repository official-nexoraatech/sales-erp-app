# [PG-048] Scheduled Report Delivery — Distributed Lock

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Reporting
**Priority:** Medium
**Complexity:** S — the fix is either a small addition (a Redis lock around one method) or a migration of scheduling ownership to an existing, already-proven service; no new infrastructure needs to be introduced either way.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/report-service (src/scheduler/ScheduledReportJob.ts), apps/scheduler-service (src/JobRegistry.ts, reference implementation)

---

## Overview

- **Business objective:** tenants can schedule a report (e.g. a weekly sales summary) to be generated and emailed to a fixed recipient list on a cron schedule, via real SMTP delivery (`nodemailer`) and real cron scheduling (`croner`). This works correctly today on a single `report-service` instance. If `report-service` is ever run with more than one replica (a normal horizontal-scaling step for any service under load, and something this platform's own Kubernetes-readiness package, PG-022, explicitly anticipates), **every replica independently loads and schedules every active `reportSchedules` row**, so the same scheduled report would fire on every replica at the same cron tick — a tenant's recipients would receive the same "weekly sales summary" email N times (once per replica), with N real SMTP sends each time, not a cosmetic duplicate-log-line issue.
- **Current implementation:** confirmed by direct read of `apps/report-service/src/scheduler/ScheduledReportJob.ts`. `start()` (line 34) calls `loadSchedules()` once, then re-runs it every 5 minutes via its own local `Cron('*/5 * * * *', ...)`. `loadSchedules()` (lines 51-82) queries `reportSchedules` for `active = 1` rows and, for every row not already in its own **in-memory** `Map<number, Cron>` (`private readonly jobs: Map<number, Cron> = new Map()`, line 16), registers a new local `croner` `Cron(schedule.cronExpression, () => this.runSchedule(schedule))`. There is no Redis lock, no database-level "claim" row, no leader-election, and no coordination primitive of any kind between `ScheduledReportJob` instances — `this.jobs` is a plain in-process `Map`, meaningless across process/replica boundaries. `runSchedule()` (lines 84-181) generates the report (`ReportEngine.generate`), formats it (Excel/CSV via `ReportFormatter`), and sends it via `nodemailer`'s `transporter.sendMail(...)` (line 150) — a real, externally-visible side effect with no idempotency guard around it (no dedup key, no "already sent for this scheduleId+period" check before dispatch).
- **Current architecture:** `ScheduledReportJob` is instantiated once per `report-service` process (presumably in `apps/report-service/src/main.ts` — verify exact wiring at implementation time) and owns its own croner-based scheduling entirely in-process, independent of this platform's other scheduling mechanism.
- **Current limitations:** no distributed lock, no idempotency guard on the email-send side, and this coordination gap is invisible today only because `report-service` has never been run with more than one replica — the bug is latent, not yet triggered in production, but would fire the instant horizontal scaling is applied to this service.

## Existing Code Analysis

- **What already exists and should be reused:** `apps/scheduler-service/src/JobRegistry.ts` already implements exactly this coordination problem, correctly, using BullMQ + Redis: every job registration wraps its handler in a Redis `SET key 1 EX 300 NX` distributed lock (lines 54-63 — `` `${JOB_KEY_PREFIX}:lock:${name}:${tenantId}` ``, `this.redis.set(lockKey, '1', 'EX', 300, 'NX')`), skipping execution on any pod where the lock isn't acquired (`if (!acquired) { logger.warn(...); return; }`) and releasing it in a `finally` block. This is a proven, already-running pattern in this exact monorepo — not a hypothetical best practice to research, but working code to either copy or (better) delegate to directly. `scheduler-service` also already owns BullMQ + `ioredis` as first-class dependencies and already has a general-purpose `register`/`schedule`/`triggerManual`/`pause`/`resume` job API (`JobRegistry.ts` lines 34-118) that `report-service` could call into instead of re-implementing scheduling at all.
- **`report-service` already has a live Redis connection — confirmed by direct read, not an assumption to verify later.** `apps/report-service/package.json` already lists `ioredis: ^5.4.1`, and `apps/report-service/src/main.ts` (lines 27-30) already constructs and connects a Redis client at boot: `const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true }); await redis.connect().catch(...)` — with a documented fallback ("Redis connect failed — report caching disabled") since it currently backs only an optional 3-minute report-result cache inside `ReportEngine` (main.ts line 56 comment: "Redis backs an optional 3-min report cache only ... not a health-gate") and is explicitly passed into `analyticsReportsRoutes` (line 71), not into `ScheduledReportJob` (which is constructed separately and never receives this `redis` instance today). This changes Option A from "adds a new infrastructure dependency" to "wires an already-connected, already-optional Redis client into one more consumer" — a smaller, lower-risk change than initially framed. Because report-service's existing Redis usage is explicitly best-effort (cache-only, degrades gracefully if Redis is down), the new lock must decide its own failure mode deliberately (see Architecture) rather than silently inheriting the cache's "just skip it" posture, since a lock that fails open would defeat the entire point of this package.
- **What should never be modified:** `ReportEngine.generate`, `ReportFormatter.toExcel/toCSV`, and the `nodemailer` transporter setup (lines 24-31) are all correct and unrelated to the coordination gap — this package is entirely about *how many times* `runSchedule()` gets invoked per cron tick across replicas, not about the report-generation or email-composition logic itself, which stays untouched.
- **Prior related work:** none in `ERP-PLANNING/phase-completions/` — `FEATURE_INVENTORY.md` §5.15 (Reporting) and §8 both note scheduled reports run "single-node, no distributed lock," confirmed accurate by this direct read. `apps/report-service/src/__tests__/scheduled-report.test.ts` already exists and exercises `ScheduledReportJob` — the natural home for a new distributed-lock regression test once this is fixed.

## Architecture

**Two viable fixes, both grounded in this codebase's existing proven patterns — recommending one, with justification, per this template's "surface tradeoffs" instruction rather than picking silently:**

- **Option A — bolt on a Redis lock around `runSchedule()`, keeping `ScheduledReportJob`'s own in-process `croner` scheduling as-is.** Copy `JobRegistry`'s exact lock pattern: before executing `runSchedule(schedule)`, attempt `redis.set(\`erp:report-schedule:lock:${schedule.id}\`, '1', 'EX', <ttl>, 'NX')`; skip (log + return) if not acquired; release in a `finally`. This is the smaller change — `report-service` doesn't currently depend on Redis/`ioredis` at all (verify at implementation time; if it genuinely has zero Redis dependency today, this option **adds** a new infrastructure dependency to a service that didn't have one, which is a real cost to weigh against Option B).
- **Option B — migrate scheduled-report execution into `scheduler-service`'s existing `JobRegistry` entirely, removing `ScheduledReportJob`'s own croner loop.** `scheduler-service` already solves this exact problem for its ~31 other jobs (per this platform's own documented gap that many of those jobs are themselves currently log-only stubs, PG-026 — unrelated to this package, but confirming `scheduler-service` is this platform's single, intended home for "recurring job that must not double-fire across replicas"). Under this option, `report-service` would expose an internal method (or a small internal API route, following the existing `x-internal-key` service-to-service convention already used elsewhere in this codebase, e.g. `apps/sales-service/src/api/internal.routes.ts`) that `scheduler-service` calls per active schedule, and `reportSchedules`' cron-expression-per-row model would need to be registered with `JobRegistry.register`/`schedule` per row (or per a periodic "check due schedules" job, mirroring how `ScheduledReportJob.loadSchedules()` already re-polls every 5 minutes) rather than each schedule owning its own independent `croner.Cron`.
- **Recommendation: Option A (bolt-on Redis lock), not Option B, for this package specifically.** Justification: (1) `reportSchedules` rows are **tenant-created, dynamic, and arbitrary-cron-expression**, unlike `scheduler-service`'s ~31 jobs, which are a **fixed, developer-defined set** registered once at boot (`JobRegistry.register` is called by application code at startup, not driven by a runtime-created database row per tenant) — `JobRegistry`'s current API has no concept of "a job whose cron expression and existence is created/deleted by an end-user at runtime," so Option B is a **larger redesign of `JobRegistry` itself** (adding dynamic job registration/deregistration, which `scheduler-service` doesn't do today), not a drop-in migration; (2) Option A directly closes the specific bug (duplicate email dispatch under horizontal scaling) with the smallest change, matching this package's S-complexity/Medium-priority sizing; (3) a future, larger package (not this one) could still pursue consolidating *all* recurring-job coordination into `scheduler-service`, including report schedules, as a bigger architectural unification — that is explicitly **out of scope here**, flagged as a possible follow-on, not attempted as part of this fix.
- **Component/data flow (Option A):** `ScheduledReportJob`'s existing `Cron(schedule.cronExpression, async () => { await this.runSchedule(schedule); })` callback (line 72) wraps its body: attempt Redis lock keyed by `schedule.id` (not `tenantId` alone, since multiple schedules can belong to one tenant and must not contend with each other) → on failure to acquire, log-and-return (another replica already has it) → on success, run exactly as today, release lock in `finally`.
- **Fail-open vs. fail-closed when Redis is unreachable — a deliberate decision, not inherited from the cache's posture.** `report-service`'s existing Redis usage (the `ReportEngine` result cache) is intentionally fail-open — if Redis is down, caching is silently disabled and reports still generate correctly, since a cache is a pure optimization. A distributed *lock* is different: failing open (running the schedule anyway when the lock can't be acquired/checked due to a Redis outage) reintroduces exactly the duplicate-dispatch bug this package exists to close, on a single-instance deployment too if Redis happens to be flaky. Recommend **fail-closed with a bounded exception**: if `redis.set(..., 'NX')` throws (connection error) rather than returning a clean `null`/lock-already-held result, log an error and **skip the run for that tick** rather than proceeding unlocked — a missed report send (recoverable next cron tick, or manually via the existing schedule) is a strictly safer failure mode than a duplicate real-SMTP-send fan-out. This should be called out explicitly in code review at implementation time, since it's a one-line decision (`catch` → skip vs. `catch` → proceed) with real behavioral consequences that's easy to get backwards by copy-pasting error-handling from the fail-open cache code path.

## Database Changes

Not applicable — no schema change. `reportSchedules`/`reportRunHistory` already exist and already record each run's outcome (`reportRunHistory.status`, per `runSchedule()`'s existing `RUNNING`/`COMPLETED`/`FAILED` writes) — this package adds a coordination lock around invocation, not a new table.

## Backend

- `apps/report-service/src/scheduler/ScheduledReportJob.ts`: accept the same `redis` client instance `main.ts` already constructs (lines 27-30) as a constructor parameter (mirroring how `analyticsReportsRoutes` already receives it, line 71) rather than creating a second Redis connection — `ScheduledReportJob` is not currently given this instance (confirm at implementation time exactly how it's constructed in `main.ts`, but per the current read it is instantiated separately from `analyticsReportsRoutes` and does not receive `redis`). Wrap `runSchedule`'s invocation (inside the `Cron` callback at line 72, and also inside `loadSchedules`'s own `Cron('*/5 * * * *', ...)` re-poll at line 39, which itself only *registers* jobs and is idempotent by nature via the `this.jobs.has(schedule.id)` check — the lock is only needed around actual report generation/email-dispatch, i.e. inside the per-schedule `Cron` callback, not around `loadSchedules` itself) with the acquire/skip/release pattern copied from `JobRegistry.ts` lines 54-71, applying the fail-closed exception handling described in Architecture.
- Lock key: `` `erp:report-schedule:lock:${schedule.id}` `` (per-schedule, not per-tenant, since one tenant can have many independent schedules that must be allowed to run concurrently with each other — only the *same* schedule ID running twice at once, across replicas, is the bug being prevented).
- Lock TTL: should exceed the slowest realistic report-generation+email-send duration (large Excel export + SMTP round-trip) — recommend starting at 300s (matching `JobRegistry`'s own existing TTL) and revisiting if a specific report proves slower in practice; do not compute this dynamically for v1, that's unwarranted complexity for an S-complexity fix.
- Events/Kafka: not applicable — no event-shape change; this is an internal coordination fix, invisible to any other service or event consumer.

## Frontend

Not applicable — backend-only coordination fix. The existing `SchedulesPage.tsx` (per `web-frontend/src/pages/reports/SchedulesPage.tsx`, confirmed present via earlier repo scan) needs no change; a tenant configuring a schedule sees no difference in behavior, only the guarantee that it won't silently double-fire once `report-service` scales past one replica.

## API Contract

Not applicable — no REST endpoint added or changed. This is an internal execution-coordination fix within `ScheduledReportJob`.

## Multi-Tenant Considerations

- The lock key is scoped per `schedule.id` (already implicitly tenant-scoped, since `reportSchedules.tenantId` determines which schedules exist per tenant) — no cross-tenant lock contention risk, since two different tenants' schedules always have different `schedule.id`s and thus different lock keys.

## Integration

- **report-service only.** No other of the 14 services is touched by Option A. (Option B, if ever pursued as a separate future package, would additionally touch `scheduler-service` — explicitly not part of this package.)

## Coding Standards

- Reuses the exact Redis-lock pattern already proven in `apps/scheduler-service/src/JobRegistry.ts` (`SET key 1 EX <ttl> NX`, acquire/skip/release-in-finally) rather than inventing a new distributed-locking primitive — per the Master Roadmap's "no package here should introduce a second way to do any of these" cross-cutting rule, this is the second known place in the monorepo needing this exact primitive, and both should look identical so a future reader recognizes the pattern immediately.
- `report-service` already depends on `ioredis` (`^5.4.1`, matching the version other services use) and already connects a client at boot for its report-result cache — reuse that same connection/instance for the new lock rather than opening a second Redis connection from the same process. This is consistent with `000-Master-Roadmap.md`'s note that a shared `@erp/cache` package (PG-002) is a separate, not-yet-done consolidation of per-service direct-`ioredis` usage — not adding a second ad hoc Redis client here keeps this package from making that eventual consolidation harder.

## Performance

- One additional Redis round-trip (`SET ... NX` + later `DEL`) per scheduled-report execution — negligible; scheduled reports are inherently low-frequency (cron-driven, typically daily/weekly/monthly per tenant), not a hot path.
- No change to `loadSchedules()`'s own 5-minute re-poll cadence or query shape.

## Security

- Not applicable beyond standard Redis-connection-config handling (reuse whatever Redis connection convention `scheduler-service`/other services already use — `REDIS_URL`/`REDIS_HOST` env vars per this platform's existing `.env.example` conventions, not a new bespoke config surface).

## Testing

- Extend `apps/report-service/src/__tests__/scheduled-report.test.ts`: simulate two "replicas" (two `ScheduledReportJob` instances, or two direct calls to the lock-guarded execution path sharing one Redis/mock-Redis instance) attempting to run the same `schedule.id` concurrently — assert exactly one actually calls `transporter.sendMail`/reaches `ReportEngine.generate`, the other logs a skip and returns without side effects.
- Regression case: a single-instance run (today's only tested scenario) continues to execute and dispatch exactly once, unchanged.
- Verify the lock is released (not left stuck) after both a successful run and a run that throws (the report-generation or SMTP-send path failing) — mirroring `JobRegistry`'s existing `finally`-based release, which must not leak locks on error paths.

## Acceptance Criteria

- [ ] A single-instance `report-service` deployment behaves identically to today (regression-safe) — no change in dispatch count or timing for the current, only-tested production topology.
- [ ] Two concurrent invocations of the same `schedule.id` (simulating two replicas) result in exactly one actual report generation + email dispatch, not two.
- [ ] A failed report-generation or SMTP-send still releases the lock (no permanent lock leak blocking future runs of the same schedule).
- [ ] `pnpm --filter report-service test` passes, including the new concurrent-execution regression test.

## Deliverables

- **Files to create:** none — reuses the Redis client `main.ts` already constructs.
- **Files to modify:** `apps/report-service/src/scheduler/ScheduledReportJob.ts` (accept the existing `redis` instance as a constructor param, add lock around `runSchedule` invocation with fail-closed error handling), `apps/report-service/src/main.ts` (pass the already-constructed `redis` client into `ScheduledReportJob`'s constructor, alongside how it's already passed into `analyticsReportsRoutes`), `apps/report-service/src/__tests__/scheduled-report.test.ts` (new concurrent-execution + fail-closed test).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** concurrent-dual-invocation lock test, lock-release-on-failure test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/report-service/src/scheduler/ScheduledReportJob.ts` runs scheduled/emailed reports via `croner` + real `nodemailer` SMTP delivery, entirely coordinated by an in-process `Map<number, Cron>` (line 16) with zero distributed-lock or cross-replica coordination. This is invisible today only because `report-service` has never been run with more than one replica — the moment it is, every replica independently loads and schedules every active `reportSchedules` row, causing duplicate real-SMTP-send fan-out per cron tick.

**Current Objective:** add a Redis-based distributed lock (copying the exact, already-proven pattern in `apps/scheduler-service/src/JobRegistry.ts` lines 54-71 — `SET key 1 EX <ttl> NX`, skip-on-failure, release-in-finally) around `ScheduledReportJob.runSchedule()`'s invocation, keyed per `schedule.id`, so only one replica actually executes+dispatches a given schedule per cron tick — with zero change to single-instance behavior (today's only tested/production topology).

**Architecture Snapshot:** `scheduler-service`'s `JobRegistry` already solves this exact coordination problem correctly for its own ~31 jobs, using BullMQ + `ioredis` — but those jobs are a fixed, developer-registered-at-boot set, unlike `reportSchedules`' tenant-created, dynamic, arbitrary-cron rows, which is why this package recommends bolting a lock onto `report-service`'s existing scheduling rather than migrating report schedules into `JobRegistry` wholesale (that would require adding dynamic job registration to `JobRegistry` itself, a larger, explicitly out-of-scope redesign).

**Completed Components:** `ReportEngine.generate`, `ReportFormatter.toExcel/toCSV`, the `nodemailer` transporter setup, and `reportRunHistory`'s existing RUNNING/COMPLETED/FAILED status tracking — all correct and unrelated, do not touch.

**Pending Components:** a future, separate, larger package could pursue consolidating all recurring-job coordination (including report schedules) into `scheduler-service`'s `JobRegistry` — explicitly out of scope for this package, which only adds a lock to the existing in-process croner scheduling.

**Known Constraints:** the lock must be keyed per `schedule.id`, not per `tenantId` (a tenant can have many independent schedules that must be allowed to run concurrently with each other — only the same schedule running twice, across replicas, at the same tick is the bug).

**Coding Standards:** copy `JobRegistry.ts`'s exact Redis-lock pattern (`SET key 1 EX <ttl> NX`, acquire/skip/release-in-finally) — do not invent a different locking primitive for what is the same underlying coordination problem elsewhere in this monorepo.

**Reusable Components:** `apps/scheduler-service/src/JobRegistry.ts` lines 54-71 (the exact lock pattern to copy), this platform's existing Redis-connection-config convention (reuse `REDIS_URL`/`REDIS_HOST` env-var conventions, don't invent new config).

**APIs Already Available:** not applicable — no new/changed endpoint.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/logger`; `ioredis` (already a `report-service` dependency — reuse the client `main.ts` already constructs and connects at boot for the report-result cache, don't open a second connection).

**Feature Flags:** none — this is a correctness/reliability fix, not an opt-in feature.

**Multi-Tenant Rules:** lock key scoped per `schedule.id`, which is already implicitly tenant-scoped via `reportSchedules.tenantId` — no new cross-tenant isolation concern.

**Security Rules:** not applicable beyond standard Redis-connection handling; no new permission needed since this is an internal execution-coordination fix with no new API surface.

**Database State:** no schema change — `reportSchedules`/`reportRunHistory` already have everything needed.

**Testing Status:** `apps/report-service/src/__tests__/scheduled-report.test.ts` already exists and covers single-instance scheduling/execution — extend it with the concurrent-dual-invocation and lock-release-on-failure cases described in Testing above.

**Next Session Plan:** single session — S complexity, one file's core change plus a dependency addition and test extension.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/011-Reporting/45-scheduled-report-distributed-lock.md` (PG-048). Before writing code, verify whether `apps/report-service` already depends on `ioredis`/has any existing Redis client setup (check `package.json` and `src/config.ts`) — if not, add it following the same connection-config convention already used by `apps/scheduler-service`. Copy the lock pattern from `apps/scheduler-service/src/JobRegistry.ts` lines 54-71 exactly; do not attempt the larger Option B (migrating report schedules into `scheduler-service`'s `JobRegistry`) described in this document's Architecture section — it requires a `JobRegistry` redesign (dynamic job registration) that is explicitly out of scope for this package."
