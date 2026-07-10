# OFFLINE-10 — Test Suite & Documentation for the Offline-First Program
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-10 | Effort: Medium (3–5 days, scales with how many of OFFLINE-01–09 have landed) | Risk: Low (test/doc work, but closes a real quality gap)
## Depends on: whichever of OFFLINE-01 through OFFLINE-09 have been implemented by the time this phase runs — this phase should be run last, or re-run incrementally after each earlier phase if the team prefers test-as-you-go over a single end-of-program pass
## Unlocks: nothing further — this is the closing phase of the OFFLINE-XX series
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §8 (finding: "no tests exist... untested"), roadmap Phase 10

---

## YOUR ROLE

You are the **QA/Platform Engineer** closing the audit's finding that "`apps/pos-frontend`
has no `__tests__` directory, no `*.test.*`/`*.spec.*` file, and no test runner
configured... the offline queue and sync logic are completely untested." Every prior
phase in this series (OFFLINE-01 through 09) includes its own phase-specific testing
requirements — this phase's job is to ensure there's an actual, repeatable, CI-runnable
test suite behind all of it, not just the individual verification steps done ad hoc
during each phase, plus documentation for anyone operating or maintaining this system
afterward.

**Recommendation, not a hard requirement:** rather than treating this strictly as "the
last phase run once at the end," each of OFFLINE-01 through 09 should ideally leave
behind its own tests as it lands (their phase-prompts each have a "Testing
Requirements" section for exactly this reason). This phase exists to (a) catch any gaps
where that didn't happen, (b) add the cross-cutting/end-to-end tests no single phase
owns on its own, and (c) produce the documentation deliverable. If run at the true end of
the program, treat every earlier phase's testing section as a checklist to re-verify,
not just this document's own list.

---

## PRE-FLIGHT CHECKLIST

- [ ] Confirm which of OFFLINE-01 through 09 have actually landed (`ERP-PLANNING/phase-completions/OFFLINE-0X_COMPLETION.md` existing = landed) — this phase's actual scope depends entirely on this
- [ ] Read `apps/pos-frontend/package.json` — confirm current test-runner state (none, per the original audit; may have changed if OFFLINE-03 added a minimal vitest config)
- [ ] Read `apps/web-frontend`'s existing vitest+RTL setup (added in ES-22, per prior project memory) as the convention to match for any new `pos-frontend` test infrastructure, rather than inventing a different test-tooling setup for a sibling app
- [ ] Read each landed `OFFLINE-0X` phase-prompt's "Testing Requirements" section and cross-check against what tests actually exist in the codebase today — don't assume a phase's completion report claiming "tests pass" means comprehensive coverage exists; verify directly
- [ ] Identify existing documentation locations that should be updated: `docs/training/CASHIER_GUIDE.md` (per the hardware-readiness audit, already known to describe non-existent POS features — this is a good opportunity to reconcile it with what's actually built), any developer-facing README in `apps/pos-frontend`, and `ERP-PLANNING/ERP_MASTER_SPEC.md` if it documents architecture that should now mention the offline layer

---

## PROJECT CONTEXT

### Why this matters beyond "more tests are good"

The single most severe bug this whole program exists to fix (duplicate invoices on
retried sync, OFFLINE-02) is exactly the kind of bug that "looks fine in manual
testing" and only surfaces under race conditions or repeated failure/retry sequences —
precisely what an automated concurrency/retry test catches and manual QA usually
doesn't. An untested idempotency mechanism is not meaningfully safer than no
idempotency mechanism, from a production-confidence standpoint. This phase is what
turns "we built it and it seemed to work" into "we can prove it."

### Documentation scope

Per the original spec's Phase 15 list (Offline architecture, Synchronization
architecture, Local database, Conflict resolution, Deployment, Disaster recovery,
Troubleshooting, Hardware compatibility, Administrator/Cashier/Store-manager/Developer
guides) — scale this to what's actually been built by the time this phase runs, not the
full aspirational list if only a subset of OFFLINE-01–09 has landed. A short, accurate
document describing what exists is more valuable than a long document describing
aspirational architecture that isn't there yet.

### Coding Standards
- Match `apps/web-frontend`'s vitest+RTL conventions for any new `pos-frontend` test infrastructure
- Tests should be deterministic — especially for concurrency/race scenarios (OFFLINE-02's simultaneous-`operationId` test, OFFLINE-06's background-sync test), avoid flaky timing-based assertions where a more deterministic mock/fake-timer approach is possible

---

## OBJECTIVE

1. `apps/pos-frontend` has a working test runner and meaningful coverage of every offline mechanism built in OFFLINE-01 through whichever phases have landed (auth refresh, idempotent sync, local DB, delta sync, feature breadth, background sync, conflict resolution)
2. Cross-cutting/end-to-end scenarios that no single phase owns (e.g. "queue 10 sales offline across a simulated multi-hour gap, including a token expiry, then reconnect and verify all 10 sync exactly once with no duplicates") are tested
3. Documentation exists describing the offline architecture as actually built, deployment/rollback guidance, troubleshooting for common failure modes, and any cashier/admin-facing guide updates needed to match real behavior

---

## SCOPE

### Step 1 — Test infrastructure

If not already added by OFFLINE-03, set up a test runner for `apps/pos-frontend`
matching `web-frontend`'s vitest+RTL convention. Configure it in this app's `package.json`
and add a `test` script consistent with the rest of the monorepo's `pnpm test --filter`
convention.

### Step 2 — Fill coverage gaps per landed phase

For each landed `OFFLINE-0X` phase, verify its own "Testing Requirements" section is
actually implemented as real, passing, CI-runnable tests — not just manually verified
once during that phase. Write any missing tests.

### Step 3 — Cross-cutting scenario tests

Build the scenarios no single phase owns:
- Full outage-and-recovery simulation: queue several sales while "offline" (mocked),
  simulate token expiry mid-outage, reconnect, verify token refresh + full sync + zero
  duplicates
- Background-sync-unsupported-browser fallback still working correctly end-to-end
- A stuck stock-conflict item resolved via the OFFLINE-07 UI results in exactly one
  final invoice, not zero or two

### Step 4 — Documentation

Write/update:
- An offline-architecture document (in `ERP-PLANNING/reports/` or wherever this
  program's other docs live) describing the local DB schema, sync protocol, idempotency
  mechanism, and conflict-resolution flow as actually implemented
- A troubleshooting section covering the failure modes this program specifically
  guards against (stuck items, conflicts, token refresh failures) and how an admin/store
  manager should recognize and respond to each
- Reconcile `docs/training/CASHIER_GUIDE.md` with the actual, current POS feature set —
  this is a good moment to fix the previously-flagged mismatch (guide describes
  discount/split-payment/UPI/auto-print/WhatsApp-receipt features that don't exist) at
  least for the offline-related sections this program touched (receipt, sync status,
  conflict resolution), even if fixing the guide's other unrelated mismatches is
  out of this phase's scope

### OUT OF SCOPE
- Fixing `CASHIER_GUIDE.md` mismatches unrelated to this program's changes (discount
  button, split payment, UPI display) — note them as a separate, still-open item rather
  than silently expanding scope to fix everything wrong with that guide
- Load/performance testing at multi-store scale — deferred per the roadmap until real usage data exists
- E2E browser-automation testing (Playwright/Cypress) unless the monorepo already has this tooling elsewhere and adding POS coverage to it is a small lift — check first rather than introducing a new E2E framework for this phase alone

---

## TESTING REQUIREMENTS

*(this phase's own deliverable IS the test suite — the requirement here is that it exists, passes, and is wired into whatever CI configuration this monorepo already uses)*

1. `pnpm test --filter @erp/pos-frontend` runs and passes, covering every landed OFFLINE-0X mechanism
2. The cross-cutting scenario tests from Step 3 pass reliably (run them multiple times to check for flakiness before considering this phase done)
3. CI (`.github/workflows/ci.yml` or equivalent) picks up the new test command if it doesn't already run `pnpm test` across all apps

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/pos-frontend test
pnpm --filter @erp/pos-frontend build
pnpm lint
pnpm type-check
```

---

## VERIFICATION CHECKLIST

- [ ] `apps/pos-frontend` has a working, CI-integrated test runner
- [ ] Every landed OFFLINE-0X phase's testing requirements are backed by real passing tests
- [ ] Cross-cutting outage/recovery/conflict scenarios are tested and pass reliably (not flaky)
- [ ] Offline-architecture documentation exists and matches what's actually built
- [ ] `CASHIER_GUIDE.md`'s offline-related sections (receipt, sync status, conflict resolution) match actual behavior

---

## REGRESSION CHECKLIST

- [ ] Existing `web-frontend` test suite is unaffected
- [ ] CI pipeline still passes end-to-end with the new test command added

---

## DEFINITION OF DONE

- [ ] Test suite exists, passes, and covers every landed offline mechanism, including cross-cutting scenarios
- [ ] Documentation (architecture, troubleshooting, relevant cashier-guide sections) is accurate and complete for what's actually built
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-10_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-10 complete, and the roadmap's overall status updated to reflect how much of the original 15-phase spec has actually been delivered

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-10_COMPLETION.md`

```markdown
# OFFLINE-10 Completion Report — Test Suite & Documentation
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## Phases Covered
| Phase | Landed? | Test coverage added |
|---|---|---|
| OFFLINE-01 | | |
| OFFLINE-02 | | |
| OFFLINE-03 | | |
| OFFLINE-04 | | |
| OFFLINE-05 | | |
| OFFLINE-06 | | |
| OFFLINE-07 | | |
| OFFLINE-08 | | |
| OFFLINE-09 | | |

## Cross-Cutting Tests Added
[List]

## Documentation Updated
[List of files, e.g. CASHIER_GUIDE.md sections, new architecture doc]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- CASHIER_GUIDE.md mismatches unrelated to this program (discount/split-payment/UPI) remain open
- [Any phases not yet landed at the time this ran, and their test coverage deferred accordingly]
```
