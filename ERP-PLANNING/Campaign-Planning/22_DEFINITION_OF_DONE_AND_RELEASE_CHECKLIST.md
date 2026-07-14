# 22 — Definition of Done & Release Checklist

## Per-Phase Definition of Done

Every phase (CP-1 through CP-8) is done only when **all** of the following are true:

1. **Functional**: every item listed for that phase in `21_IMPLEMENTATION_ROADMAP.md` and
   `07_FEATURE_BACKLOG.md` is implemented and manually verified against its acceptance criteria in
   `06_USER_PERSONAS_AND_STORIES.md` where one exists.
2. **No regression**: `apps/web-frontend/e2e/live-crm.spec.ts` passes unmodified in intent (per
   `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`).
3. **Tests written alongside code**, not deferred to CP-9 — unit tests for new domain logic, integration
   tests for new endpoints, at minimum (full bar in `23_TESTING_STRATEGY.md`).
4. **Tenant isolation verified**: every new table/query scoped by `tenant_id`; spot-checked against
   `NFR-06`.
5. **Permissions verified end-to-end**: for any new permission, the grant (role-defaults) and the guard
   (route/UI check) use the identical constant — explicitly checked, not assumed (`R1` in
   `20_RISK_ASSESSMENT.md`).
6. **Backward compatibility verified**: no renamed/removed column, endpoint, or status value, per
   `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`.
7. **Documentation updated**: this folder's relevant doc(s) reflect what was actually built (not just what
   was planned) — including any deviations from the plan and why.
8. **Completion report generated**: `phase-completions/CP-N_COMPLETION.md` written using the parent
   `ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md` format, and the status tracker in `README.md` +
   `21_IMPLEMENTATION_ROADMAP.md` updated.
9. **No unchecked deployment steps left silently pending** — if the phase requires a manual DB migration or
   data migration, it is called out explicitly in the completion report's Deployment Checklist section (per
   the project's CLAUDE.md session-start rule) so a future session doesn't miss it.

## CP-9 Definition of Done (the release gate)

CP-9 is done only when, in addition to the above:

1. Every test category in `23_TESTING_STRATEGY.md` has been executed with results recorded.
2. The full Playwright suite in `24_PLAYWRIGHT_TEST_PLAN.md` passes.
3. A cross-phase consistency review has been run (see the "Quality Checkpoints" pattern in the parent
   `ERP-PLANNING/README.md`), adapted to this module: are all new tables tenant-scoped, do all new API
   responses follow the ERP's response envelope format, is every state-changing operation outbox-based, is
   every new endpoint permission-guarded and audit-logged, is dark mode/a11y applied to every new frontend
   surface.
4. Performance targets in `05_NON_FUNCTIONAL_REQUIREMENTS.md` (`NFR-01`–`NFR-03`) are measured, not assumed.
5. Security validation (webhook signature verification, media upload validation, no secrets in logs) is
   explicitly checked against `NFR-13`–`NFR-16`.
6. Compliance validation: consent/opt-out enforcement re-verified across every channel and every new
   automated/recurring send path (not just manual sends).

## Release Checklist (final sign-off before calling the platform "enterprise-grade omnichannel")

- [ ] All Must Have backlog items (`07_FEATURE_BACKLOG.md`) shipped and verified.
- [ ] All Should Have items shipped, or explicitly deferred with a documented reason.
- [ ] Full regression suite green (unit + integration + E2E + Playwright).
- [ ] Performance tested at the volume assumptions in `18_PERFORMANCE_AND_SCALABILITY.md`.
- [ ] Accessibility (axe-core) clean on every new/changed frontend surface.
- [ ] Security review complete: webhook signature verification, permission end-to-end checks, no secret
      leakage, tenant isolation.
- [ ] Compliance review complete: consent model, preference center, guaranteed unsubscribe, audit trail.
- [ ] All 9 phase completion reports exist in `phase-completions/` and are internally consistent with each
      other and with the current code.
- [ ] `README.md` status tracker shows all phases Complete.
- [ ] Rollback plan confirmed for the most recent phase (per the expand-then-contract principle in
      `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`).
