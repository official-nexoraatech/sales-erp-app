# 27 — Post-Implementation Review

No `26-implementation-report.md` precedes this document — unusually, the bulk of Phase 3A/3B's
code (route gating, migration, navigation, provisioning defaults) was already implemented and
even applied to the dev DB in an earlier, uncommitted session this repository's own session
history doesn't otherwise document. This review both verifies that prior work from scratch
(nothing taken on faith) and closes the gaps found. Written same-session as the gap-closing
work below, not a separate independent pass — same caveat `phase-04`'s own review states:
recommend a fresh-session independent review before citing this phase at Phase 1/2B's
verification tier.

## What this pass actually did, not just re-read

1. Read every touched route file's real diff (`payroll.routes.ts`, `pos.routes.ts`,
   `day-end.routes.ts`, `promotion.routes.ts`) rather than trusting the plan's own file list —
   confirmed 13 payroll routes and 17 POS-surface routes gated, internal payroll routes and
   `employee.routes.ts` confirmed untouched (D2).
2. Found and fixed a **real gap**: two "real-DB integration test" files the plan called for
   (`payroll-capability-integration.test.ts`, `pos-capability-integration.test.ts`) didn't
   exist. No precedent for that exact shape existed anywhere in this codebase either — every
   prior capability test (the SDK's own `capability-guard-route.test.ts`, Phase 2B's
   `item-batch-capability.test.ts`/`near-expiry-stock-route.test.ts`) mocks
   `PlatformFeatureFlags`/`isCapabilityEnabled`/`requireCapability` rather than exercising real
   Postgres + real Redis. Surfaced this to the user rather than silently substituting live
   verification for it; user chose to build the real thing. Added `ioredis` as a devDependency
   to `hr-service`/`sales-service` (previously only reachable transitively) and wrote both
   files — first-ever real-DB-and-Redis integration tests in this codebase. Both pass,
   including an explicit Redis-L2-cache-invalidation step between the disabled and enabled
   assertions (without it, the second assertion would silently read the pre-flip cached value
   for up to 5 minutes).
3. Found and fixed a **real, unrelated-looking but blocking bug** during live verification:
   `auth-service`'s running `dist` build was stale — built before `users.ts` gained its
   `enabledCapabilities` computation, so `GET /users/me` never returned the field at all,
   regardless of any tenant's actual flag state. This made the Payroll nav item appear
   permanently hidden in live testing, which looked at first like a capability-resolution bug
   but was purely a forgotten rebuild (I had also mis-diagnosed `PORT=3010` as a stale
   `hr-service` process earlier in this session and killed the real `auth-service` — restarting
   it from the same stale `dist` masked the real cause until the rebuild). Rebuilt and
   restarted `auth-service`; re-verified cleanly afterward.
4. Ran the full `hr-service` and `sales-service` regression suites (not spot checks) after
   adding the two new test files, and diffed the failure list against this session's own
   already-individually-classified baseline (every failure confirmed by grep to hardcode
   `.setIssuer('erp-test')` without setting `process.env['JWT_ISSUER']` — the pre-existing,
   cross-session `JWT_ISSUER` bug, unrelated to payroll/POS/capability code) — zero new
   failures in either service.

## Re-verified claims (independently, not copied from the plan)

- **D1 backfill correctness**: re-queried `feature_flags` directly — tenant 1 (the
  zero-prior-rows ENTERPRISE case the decision record calls out by name) now shows both flags
  `true`; all 14 `STARTER` tenants in this dev dataset show `count(enabled=true) = 0` across
  both flags; all 3 `ENTERPRISE` tenants show both flags `true`. No `GROWTH`-plan tenant exists
  in this dev dataset, so the `pos.enabled=true, hr.payroll.enabled=false` split the migration's
  `WHERE pe.feature_flags @> ...` logic implies for that plan is untested against live data —
  the query logic is plan-agnostic (joins generically against `plan_entitlements`, no
  per-plan branching), so this is a **data coverage gap, not a code gap**, but it is
  honestly unverified rather than silently assumed.
- **Migration idempotency**: re-ran `0171_hr_payroll_pos_entitlement_backfill.sql` a second
  time directly against the dev DB — `UPDATE 0 / UPDATE 0 / INSERT 0 0 / INSERT 0 0`, confirming
  no further changes on a repeat run.
- **`plan_entitlements` seed data**: re-queried directly — `STARTER` has neither flag,
  `GROWTH` has `pos.enabled` only, `ENTERPRISE` has both, exactly matching D1's design.
- **Metric wiring**: `erp_capability_check_denied_total` is pre-existing Phase 1 code in
  `capability-guard.ts`, unchanged by this phase. Live-verified on both services via real
  denials against a real tenant (2), not just read from source:
  `erp_capability_check_denied_total{capability_key="HR_PAYROLL",outcome="disabled"}` and the
  `POS` equivalent both incremented correctly on `/metrics` after a real 403.
- **Security scope**: `git diff` across every touched file shows no new trusted header, no new
  audit-log write — the only new field anywhere is `AuthUser.enabledCapabilities?: string[]` on
  the frontend (a UI-filtering value, explicitly commented as non-authoritative) and
  `NavItem.capabilityKey?: string` (nav metadata, no runtime security effect).
- **Backward compatibility scope**: the pre-existing, already-passing integration tests
  (`pos-completion.test.ts`, `pos-sessions-active.integration.test.ts`,
  `offline02-pos-sale-idempotency.test.ts`, `payroll-preflight.test.ts`) that exercise these
  exact routes end-to-end pass unchanged with `requireCapability` mocked to always-allow — the
  honest "zero behavior change for correctly-entitled tenants, not all tenants" scope
  `17-migration-and-backward-compatibility.md` insists on is preserved, not rounded up.

## Live verification (real browser + real infra, not just tests)

- **HR_PAYROLL nav item**: with tenant 2's `hr.payroll.enabled` flipped to `false` in Postgres
  and the Redis L2 cache entry cleared, the Payroll node disappeared from the sidebar while
  Employees/Attendance/Leave remained visible; direct navigation to `/hr/payroll` surfaced a
  toast reading the raw backend message ("This tenant's plan does not include HR_PAYROLL.")
  rather than crashing. Flipped back to `true`: Payroll reappeared, the page rendered real
  payroll-run data. Flag restored to its original `true` value when done.
- **POS friendly error message**: with tenant 2's `pos.enabled` flipped to `false`, attempting
  to open a POS shift in `pos-frontend` surfaced exactly the intended copy — "This feature isn't
  available on your plan. Ask your admin to enable it." — not a crash, not a raw error code.
  Flipped back to `true`: shift-open and the full POS terminal worked normally. Flag restored.

## Issues found

1. **Two missing real-DB integration test files** — fixed (§2 above).
2. **Stale `auth-service` build masking `enabledCapabilities`** — fixed (§3 above), and this
   review's own investigation is the only reason it surfaced; it would have shipped invisible
   to anyone who only read the source diff (which was correct) without also live-testing the
   running service.
3. **Minor, non-blocking UX asymmetry, not fixed**: `pos-frontend` has a purpose-written
   friendly message for `CAPABILITY_NOT_ENABLED` (`posErrorMessages.ts`); `web-frontend`'s
   `PayrollPage` has no equivalent and surfaces the backend's raw message via the app's generic
   error toast instead. Not a defect against this phase's acceptance criteria (which only
   required the `pos-frontend` treatment), but worth a follow-up if a friendlier HR-side message
   is wanted later.

## Residual, correctly out-of-scope items (not defects)

- The pre-existing `JWT_ISSUER` test bug (documented elsewhere, affects ~40 tests across
  unrelated files) — confirmed, not touched, per this phase's own scope.
- No `GROWTH`-plan tenant exists in dev data to observe the backfill's middle case live (§ above)
  — logic verified by code reading and the generic idempotency re-run, not by live data for
  that specific plan tier.
- No independent-session review yet (this document's own limitation, matching `phase-04`'s
  same caveat).

## Verdict

**IMPLEMENTATION VERIFIED.** All of `20-acceptance-criteria.md`'s Phase 3A, Phase 3B, database,
security, observability, and backward-compatibility items are satisfied against live code and
live infrastructure, with the two gaps found in this pass (missing integration tests, stale
`auth-service` build) closed rather than left open. Recommend a fresh-session independent review
before treating this phase at Phase 1/2B's full verification tier, consistent with `phase-04`'s
own recommendation for itself.
