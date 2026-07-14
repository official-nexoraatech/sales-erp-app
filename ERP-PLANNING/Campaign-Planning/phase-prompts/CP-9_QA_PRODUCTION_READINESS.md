Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-9: QA & Production Readiness** of the Campaign Management Platform initiative. This
is the final phase (9 of 9). **All of CP-1 through CP-8 must be complete** — check every file in
`ERP-PLANNING/Campaign-Planning/phase-completions/` exists and read all of them for context on what was
actually built (vs. what was planned) and any documented deviations.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/23_TESTING_STRATEGY.md`
3. `ERP-PLANNING/Campaign-Planning/24_PLAYWRIGHT_TEST_PLAN.md`
4. `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`
5. `ERP-PLANNING/Campaign-Planning/05_NON_FUNCTIONAL_REQUIREMENTS.md`
6. `ERP-PLANNING/Campaign-Planning/20_RISK_ASSESSMENT.md`
7. All 8 prior `phase-completions/CP-*_COMPLETION.md` files

## Goal for This Phase

Full regression, hardening, and release sign-off for the entire Campaign Management Platform initiative.
This is not the first time tests are written — every prior phase should already have unit/integration
coverage per its own Definition of Done. This phase verifies the whole system together and closes any gaps.

## Scope

1. **Run and record results for every test category** in `23_TESTING_STRATEGY.md`: unit, component,
   integration, E2E, regression, performance, accessibility, cross-browser, responsive, security,
   permission/role, error-handling/recovery.
2. **Complete the full Playwright suite** per `24_PLAYWRIGHT_TEST_PLAN.md` — every spec listed should exist
   by now (added incrementally per phase); consolidate and add `campaign-regression.spec.ts` (the full
   lifecycle walk + cross-module + cross-browser/mobile pass).
3. **Cross-phase consistency review**: are all new tables tenant-scoped, do all new API responses follow
   the ERP's response envelope format, is every state-changing operation outbox-based, is every new
   endpoint permission-guarded (grant constant == guard constant, checked explicitly per R1) and audit-
   logged, is dark mode/a11y applied everywhere new.
4. **Performance validation**: measure (don't assume) the `NFR-01`–`NFR-03` targets in
   `05_NON_FUNCTIONAL_REQUIREMENTS.md` at the volume assumptions in `18_PERFORMANCE_AND_SCALABILITY.md`.
5. **Security validation**: webhook signature verification (valid/invalid/replayed), media upload validation
   (server-side, not just client), no secret leakage, tenant isolation spot-checks.
6. **Compliance validation**: consent/opt-out enforcement re-verified across every channel and every
   automated/recurring send path, not just manual sends.
7. **Final release checklist** in `22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md` — go through every item.

## Rules

- If any gap is found, decide with me whether it's a release blocker or a documented known-limitation
  (update `20_RISK_ASSESSMENT.md`/`07_FEATURE_BACKLOG.md` accordingly) — don't silently skip it.
- Do not add new features in this phase — this is verification and hardening only.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-9_COMPLETION.md`, mark all phases Complete in
`README.md` and `21_IMPLEMENTATION_ROADMAP.md`, and produce a final release summary: what shipped, what was
deferred, and what known limitations remain.
