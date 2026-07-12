# Chaos Engineering Cadence (PG-056)

**Status:** Adopted 2026-07-11. Turns the one-time exercise in
`chaos-engineering-report.md` (2026-07-01) into a recurring quarterly practice.

---

## 1. Schedule

**Quarterly, first Monday of Q1/Q2/Q3/Q4** — the same cadence the DR-drill
report (`dr-drill-report.md`, Recommendation #3) already recommended for
itself. Run both drills in the same maintenance window where practical: they
exercise overlapping infrastructure (the local Docker Compose stack today;
Kubernetes staging with Chaos Mesh/Litmus once that tooling is adopted, per
both original reports' own stated intent).

**Automated reminder:** `platform.chaos-drill-reminder`, a cron job in
`apps/scheduler-service/src/jobs/system-jobs.ts`, fires `0 9 1 1,4,7,10 *`
(approximating "first Monday of the quarter" as the 1st of Jan/Apr/Jul/Oct,
09:00 — same approximation the existing `platform.dr-drill-reminder` job
uses) and emails whoever `CHAOS_DRILL_OWNER_EMAIL` (see `.env.example`) points
at. It does not execute any fault injection itself — a human still runs the
drill and judges whether the expected behavior actually happened.

**Next due date:** 2026-10-01 (Q4 2026). The 2026-07-01 baseline run counts as
the Q3 2026 exercise; the next one is Q4.

---

## 2. What the next run must cover

1. **New: Experiment 3.2b — caller-level idempotency-dedup re-test.**
   `chaos-engineering-report.md` Experiment 3.2 found that its originally
   planned `notification_retry` BullMQ job was never built; the actual
   mechanism is `NotificationEngine.deliverWithRetry()`'s synchronous
   in-process retry (2s/4s backoff, 3 attempts). The report's own verdict
   admits ES-26's idempotency key (`notification_log.idempotency_key`) has
   never been chaos-tested against a _caller-level_ retry (i.e., a second,
   independent retry attempt landing on an already-recently-sent
   notification, not just MSG91 returning 500 mid-attempt). This is the
   highest-priority new addition to the next run's calendar — test it before
   or alongside the full re-run below.
2. **Full re-run of all 9 original experiments** (1.1, 1.2, 2.1, 2.2, 3.1,
   3.2, 3.3, 4.1, 4.2), using the same fault-injection commands and evidence
   queries already documented in `chaos-engineering-report.md`. This is a
   regression check — a previously-PASSing path (e.g. saga compensation,
   outbox durability) can silently break from unrelated refactors since
   2026-07-01.

## 3. Report naming convention

Each run produces its own dated file — the original report is never edited:

```
ERP-PLANNING/phase-completions/chaos-engineering-report-<YYYY-QN>.md
```

e.g. `chaos-engineering-report-2026-Q4.md`. Same structure as the original
(per-experiment fault/expected/actual/evidence/verdict/fix-required table +
summary table), plus one new top section not present in the original:

- **"Regressions vs. Previous Run"** — explicitly diff this run's verdicts
  against the immediately prior run's, so a regression is visible at a
  glance instead of requiring a side-by-side read of two report files.

`chaos-engineering-report.md` itself stays as-is permanently as the
2026-07-01 / Q3-2026 historical baseline.

## 4. Findings become PG-XXX packages

Any experiment that regresses from PASS to FAIL, or any newly-discovered gap
surfaced during a run, gets filed as its own `PG-XXX` package under
`ERP-PLANNING/production-gap-prompts/`, following `_TEMPLATE.md`, in whichever
category folder fits the finding (e.g. a saga-compensation regression →
`001-Architecture/`; an RBAC gap surfaced mid-fault-injection →
`002-Security/`). Findings do not live only inside the dated report — the
report records what was tested and observed; the backlog tracks what needs to
be fixed.

## 5. Related runbook

`infrastructure/runbooks/dr-runbook.md` now exists (shipped by PG-024, after
this gap-prompt was originally written believing it didn't) and documents the
DR-restore procedure end to end. There is no equivalent step-by-step runbook
for chaos experiments — the experiment definitions in
`chaos-engineering-report.md` (fault/expected/evidence per experiment) serve
that purpose today. If a dedicated chaos runbook is ever written, cross-link
it here rather than duplicating the DR runbook's structure.

## 6. Constraints (unchanged from the original run)

Fault-injection commands (`docker stop`, `tc qdisc`, `redis-cli CONFIG SET`,
etc.) must only ever run against local/staging environments, never
production.
