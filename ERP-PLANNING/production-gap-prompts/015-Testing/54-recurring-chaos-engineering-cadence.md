# [PG-056] Recurring Chaos-Engineering Cadence

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Testing
**Priority:** Low
**Complexity:** S — no new experiments to invent, just scheduling/process wrapping around work already done once plus a small script to automate re-runs.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `ERP-PLANNING/phase-completions/chaos-engineering-report.md` (source material), new `ERP-PLANNING/phase-completions/chaos-engineering-report-<date>.md` per future run, `.github/workflows/` (optional scheduled reminder), `infrastructure/docker`

---

## Overview

- **Business objective:** A chaos-engineering exercise has already been run once (`ERP-PLANNING/phase-completions/chaos-engineering-report.md`, dated 2026-07-01, "Phase 13") — 9 experiments across 4 fault categories (network, database, external-service, resource-exhaustion), all 9 marked PASS. That is real, valuable evidence the system's failure-handling (saga compensation, cache fallback, outbox durability, circuit breakers) works — as of the date it was tested. The gap is not that chaos testing has never happened; it's that it happened exactly once and there is no mechanism ensuring it happens again. A resilience property proven true on 2026-07-01 is not guaranteed true after every subsequent change to sagas, retry logic, or infrastructure config — without a recurring cadence, regressions in failure-handling paths would only surface in a real production incident, which is the exact scenario chaos engineering exists to pre-empt.
- **Current implementation:** One completed report, `chaos-engineering-report.md`, structured as a "Monthly Chaos Calendar" (its own internal framing — Week 1 Network Faults, Week 2 Database Faults, Week 3 External Service Faults, Week 4 Resource Exhaustion) that was run as a single one-time pass through all four weeks rather than as an actual recurring monthly practice. No scheduled job, calendar reminder, CI workflow, or process doc currently re-triggers any of these 9 experiments. No "next run due" date exists anywhere.
- **Current architecture:** All 9 experiments were run manually against a local Docker Compose stack (the report's own header: "All experiments run against the local Docker Compose stack. Production chaos should be run with Chaos Mesh or Litmus on Kubernetes staging" — i.e., even the _original_ run explicitly deferred the production-grade tooling (Chaos Mesh/Litmus) to a later, not-yet-done step). Two concrete infrastructure fixes came out of that one run and are already merged: `statement_timeout = 3000` added to `infrastructure/docker/postgres/init.sql`, and `resources.limits.memory: 512Mi` added to the Kubernetes manifest template (`infrastructure/k8s/auth-service.yaml`, described as "template for all" in the report's own fix table — worth verifying this was actually propagated to all 14 manifests, not just `auth-service.yaml`, since the report only names one file).
- **Current limitations:** No recurring schedule. No re-verification of the one partially-fixed finding: **Experiment 3.2** (MSG91 SMS 500 → retry) originally called for a `notification_retry` BullMQ job with 30s/2m/10m exponential backoff in its write-up, but the report's own "Fix Required" column admits that mechanism "was never actually built" — the real shipped implementation is a synchronous in-process retry (2s/4s backoff, 3 attempts, via `NotificationEngine.deliverWithRetry()`) plus a separate idempotency key added later in ES-26. The chaos report explicitly flags that its own experiment "only exercised the internal backoff, not that caller-retry scenario" — i.e., the idempotency-dedup path added by ES-26 has **never actually been chaos-tested**. This is the single most concrete "found broken/incomplete, only partially addressed" item in the existing report and should be the first thing re-tested, not a fresh unrelated scenario.

## Existing Code Analysis

- **What already exists and should be reused:** All 9 experiment definitions in `chaos-engineering-report.md` (fault injected, expected behavior, evidence query/command per experiment) — these are a ready-made regression script; re-running them means re-executing the same `docker stop`/`docker pause`/`tc qdisc`/`redis-cli CONFIG SET` commands and the same SQL/curl evidence checks already documented, not designing new experiments from scratch. The report's own "Summary" table (experiment name → week → fault category → status) is a reusable checklist template for every future run.
- **What should never be modified:** The original `chaos-engineering-report.md` — it is a historical record of the 2026-07-01 run and must stay as-is (do not edit it retroactively to reflect newer findings). Each future run produces its **own** dated report file (see Architecture), preserving history the same way this project already does for `phase-completions/ES-XX_COMPLETION.md` files (one file per completed unit of work, never overwritten).
- **Prior related work:** The DR-drill report (`ERP-PLANNING/phase-completions/dr-drill-report.md`, same date, same author) already recommends its own recurring cadence in its "Recommendations for Production" section: "Test quarterly: This drill should run every 3 months. Schedule: first Monday of Q1, Q2, Q3, Q4." That DR-drill cadence recommendation is a **direct precedent** for this package — align the chaos-engineering cadence to the _same_ quarterly schedule so both resilience-verification practices run together (same drill day makes operational sense: DR restore + chaos fault injection are complementary and can share the same maintenance window). Note also: the DR-drill report references a runbook at `infrastructure/runbooks/dr-runbook.md` that does **not exist** in the repository (verified via `Glob` — `infrastructure/` has no `runbooks/` directory at all) — this is a stale forward-reference from that report, not something this package should assume exists; if a future session builds that runbook (see PG-057, which covers deployment runbooks specifically, not DR), the chaos cadence doc should cross-link it, not duplicate it.

## Architecture

- No new system architecture — this package is process/scheduling, not code. The "architecture" here is the recurring-run process itself:
  1. **Cadence:** Quarterly, aligned with the DR-drill report's own recommended schedule (first Monday of Q1/Q2/Q3/Q4) — run both drills back-to-back in the same maintenance window where practical, since they exercise overlapping infrastructure (Docker Compose stack, or Kubernetes staging once Chaos Mesh/Litmus is adopted per the original report's own stated intent).
  2. **First re-test priority:** Experiment 3.2's caller-level idempotency-dedup scenario (the ES-26 idempotency key path that was never actually chaos-tested) — add this as a _new_ sub-experiment (3.2b) to the next run's calendar, not a replacement of 3.2 itself (3.2's original synchronous-retry behavior should still be re-verified too, since code has moved since 2026-07-01).
  3. **Full re-run of all 9 original experiments**, each quarter, using the same fault-injection commands and evidence checks already documented — this catches regressions in previously-passing paths (e.g., if a future refactor of `NotificationEngine` or the saga compensation logic silently breaks what Experiment 1.1 or 3.2 proved worked).
  4. **New findings feed back into this same `production-gap-prompts` backlog**, not into an ad hoc note: any experiment that regresses from PASS to FAIL, or any newly-discovered gap surfaced during a run, gets its own `PG-XXX` package following the exact `_TEMPLATE.md` structure, filed under whichever category folder fits the finding (e.g., a saga-compensation regression → `001-Architecture/`; a new RBAC gap surfaced during a fault-injection test → `002-Security/`). This keeps chaos findings in the same tracked, actionable format as every other gap in this roadmap instead of living only in a markdown report nobody re-reads.
  5. **Report location convention:** each run produces `ERP-PLANNING/phase-completions/chaos-engineering-report-<YYYY-QN>.md` (e.g. `chaos-engineering-report-2026-Q4.md`), following the same structure as the original (per-experiment fault/expected/actual/evidence/verdict/fix-required table + summary table), with a new top section, **"Regressions vs. Previous Run,"** explicitly diffing this run's verdicts against the immediately prior run's — this is the one structural addition over the original report format, since a truly recurring practice needs to make regressions visible at a glance, not just re-prove the same 9 PASSes in isolation each time.
- No component interaction/data-flow diagram needed — this is a testing-process package, not a system-design one.

## Database Changes

Not applicable — no schema change.

## Backend

Not applicable — no application code changes. (If a future run's findings require a code fix, that fix belongs to whatever new `PG-XXX` package the finding spawns, not to this cadence-setup package itself.)

## Frontend

Not applicable — no UI changes.

## API Contract

Not applicable.

## Multi-Tenant Considerations

Not applicable — chaos experiments run against the local/staging Docker Compose or Kubernetes stack, not against live tenant data; no tenant-isolation concern is introduced by scheduling re-runs.

## Integration

- **`ERP-PLANNING/phase-completions/`** — new dated report per quarterly run, alongside the existing `chaos-engineering-report.md` and `dr-drill-report.md`.
- **`ERP-PLANNING/production-gap-prompts/`** — the feedback destination for any new finding; no other service integration.
- **Optional lightweight automation:** a scheduled GitHub Actions workflow (e.g. `.github/workflows/chaos-reminder.yml`) that simply opens a tracking GitHub Issue on the first Monday of each quarter reminding the team the drill is due — this is a reminder mechanism, not an automated chaos-execution pipeline (the original experiments involve manual `docker stop`/`tc qdisc`/`redis-cli` commands against a real environment and human judgment on "did the expected behavior actually happen" — full automation of destructive fault injection into CI is explicitly out of scope for this Low-priority, Complexity-S package; that would be its own much larger package if ever pursued, likely via Chaos Mesh/Litmus in Kubernetes staging as the original report itself already anticipated).

## Coding Standards

- Matches this repo's existing convention of dated, structured markdown reports for exercises like this (`chaos-engineering-report.md`, `dr-drill-report.md` are the precedent) rather than inventing a new report format. If the optional GitHub Actions reminder workflow is added, it follows `ci.yml`'s existing comment-banner style (`# ─── Section Name ──`).

## Performance

Not applicable — this package does not change any runtime code path.

## Security

- Not applicable in the sense of new permission constants or attack surface — but note as a process point: fault-injection commands (`docker stop`, `tc qdisc`, `redis-cli CONFIG SET`) must only ever be run against local/staging environments, never production, exactly as the original report's own header already states. This constraint carries forward unchanged into every future recurring run.

## Testing

- This package doesn't add automated tests; it schedules a recurring **manual** testing practice. The "test" of this package's own completion is procedural: confirm a tracking mechanism exists (calendar entry, recurring GitHub Issue, or equivalent) with a concrete next-due date, and confirm the Experiment 3.2b (idempotency-dedup) re-test is explicitly queued as the first new addition to the next run's calendar.

## Acceptance Criteria

- [x] A documented quarterly schedule exists (first Monday of Q1/Q2/Q3/Q4, matching the DR-drill report's own recommendation) with a concrete next-due date. Done 2026-07-11 — `ERP-PLANNING/phase-completions/chaos-engineering-cadence.md` §1, next due 2026-10-01 (Q4 2026).
- [x] The next chaos run's planned calendar explicitly includes a new Experiment 3.2b (caller-level idempotency-dedup re-test for the MSG91/notification retry path) in addition to re-running the original 9 experiments. Done 2026-07-11 — cadence doc §2.
- [x] A report-file naming convention is documented and the original `chaos-engineering-report.md` is left untouched as the historical Q3-2026 baseline. Done 2026-07-11 — cadence doc §3; original report not modified.
- [x] A written process step confirms: any new finding from a chaos run becomes its own `PG-XXX` file under `production-gap-prompts/`, following `_TEMPLATE.md`, rather than staying only inside the dated report. Done 2026-07-11 — cadence doc §4.
- [x] (If built) the optional scheduled reminder workflow successfully opens a tracking issue on a test/dry-run trigger. Done 2026-07-11, built as a scheduler job rather than a GitHub Actions workflow (a working `platform.dr-drill-reminder` cron precedent already existed from PG-024, a better fit than inventing a parallel CI mechanism) — see `platform.chaos-drill-reminder` in `apps/scheduler-service/src/jobs/system-jobs.ts`; typechecks clean, not exercised against a live notification-service (no Docker this session, same caveat as its DR sibling which also has no dedicated test).

## Deliverables

- **Files to create:** a short process doc formalizing the cadence — recommend `ERP-PLANNING/phase-completions/chaos-engineering-cadence.md` (the schedule, the re-test priority list, the report-naming convention, and the "findings become PG-XXX" rule) rather than embedding this only in this gap-prompt file, so operational staff running the next drill don't need to open the `production-gap-prompts` tree to find it. Optionally, `.github/workflows/chaos-reminder.yml`.
- **Files to modify:** none (the original `chaos-engineering-report.md` and `dr-drill-report.md` are left as-is).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** none (procedural package); future quarterly runs each produce their own dated report as the artifact of execution.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** One chaos-engineering exercise was run on 2026-07-01 (`ERP-PLANNING/phase-completions/chaos-engineering-report.md`), covering 9 experiments across network/database/external-service/resource-exhaustion fault categories, all PASS, against a local Docker Compose stack. Two real infra fixes shipped from it (`statement_timeout` on Postgres, memory limits in K8s manifests). One experiment (3.2, MSG91 retry) revealed that its originally-planned BullMQ retry job was never built — the actual shipped mechanism is a synchronous in-process retry — and the report itself admits the newer ES-26 idempotency-key path was never chaos-tested at all. A companion DR-drill report (same date) already recommends a quarterly cadence for _its own_ drill.

**Current Objective:** Turn the one-time chaos exercise into a recurring quarterly practice: schedule it (aligned with the DR-drill's own quarterly recommendation), prioritize re-testing the one flagged-incomplete area (the ES-26 idempotency-dedup path, as new sub-experiment 3.2b) before/alongside a full re-run of the original 9, and establish the rule that any new finding becomes its own tracked `PG-XXX` package rather than living only in a report file.

**Architecture Snapshot:**

1. `chaos-engineering-report.md` and `dr-drill-report.md` (both dated 2026-07-01, same author) are the only two resilience-exercise reports in the repo — both explicitly call for their tooling to eventually move from manual Docker Compose commands to Chaos Mesh/Litmus on Kubernetes staging, which has not happened yet.
2. The DR-drill report references `infrastructure/runbooks/dr-runbook.md` as if it exists — it does not (verified, no `runbooks/` directory anywhere under `infrastructure/`); don't treat that reference as ground truth.
3. `infrastructure/k8s/auth-service.yaml` is described as the "template for all" 14 manifests for the memory-limit fix — worth spot-checking whether that was actually propagated to the other 13 manifests, since the report only names one file explicitly.
4. This project's convention for exercises like this is one dated markdown report per run, never overwritten — follow that same pattern for each future quarterly chaos run.

**Completed Components:** All 9 original chaos experiments and their fixes (`statement_timeout`, K8s memory limits) — do not re-derive or redesign these experiments, only schedule their repetition.

**Pending Components:** Full automation of fault injection via Chaos Mesh/Litmus on Kubernetes — explicitly out of scope for this Low/S package; still manual Docker Compose-based re-runs for now, same as the original.

**Known Constraints:** Fault-injection commands must only target local/staging environments, never production. No live Docker stack may be available in every dev session to actually _execute_ a re-run — this package's own deliverable (the cadence doc) doesn't require live execution, only scheduling/process artifacts.

**Coding Standards:** Match the existing dated-markdown-report convention (`chaos-engineering-report.md`, `dr-drill-report.md`) rather than inventing a new report format; if a reminder workflow is added, match `ci.yml`'s comment-banner style.

**Reusable Components:** All 9 experiment definitions (fault/expected/actual/evidence/verdict columns) from the original report — reuse verbatim as the re-run script.

**APIs Already Available:** Not applicable — this is a manual operational exercise, not an API-driven feature.

**Events Already Available:** Not applicable.

**Shared Utilities:** Not applicable.

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Not applicable.

**Security Rules:** Not applicable beyond "never run fault-injection against production."

**Database State:** Not applicable — no schema/migration involvement.

**Testing Status:** One completed exercise (9/9 PASS) as of 2026-07-01; zero recurring cadence exists yet.

**Next Session Plan:** Single session — this is a scheduling/process document, not an implementation task requiring multiple sessions.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/015-Testing/54-recurring-chaos-engineering-cadence.md` and implement PG-056: write the `chaos-engineering-cadence.md` process doc (quarterly schedule aligned to the DR-drill's own recommendation, the Experiment 3.2b re-test priority, the report-naming convention, and the 'findings become PG-XXX' rule), and optionally the scheduled reminder workflow. Do not re-run the actual chaos experiments as part of writing this package — that's the next scheduled drill's job, not this planning package's."
