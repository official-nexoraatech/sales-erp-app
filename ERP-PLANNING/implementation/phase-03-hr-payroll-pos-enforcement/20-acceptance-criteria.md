# 20 — Acceptance Criteria

## Prerequisite (blocks all of Phase 3A/3B)

- [ ] D1 (rollout-safety approach) answered by the user — `25-decision-record.md`.
- [ ] D1b (new-tenant provisioning default) answered alongside D1.
- [ ] D2 (internal payroll routes) and D3 (POS Z-report/promotion bundling) confirmed or overridden by the user.

## Phase 3A — HR_PAYROLL

- [ ] All 6 user-facing routes in `payroll.routes.ts` gain `requireCapability('HR_PAYROLL', ctxFactory.rawDb, ctxFactory.getRedis())` before their existing permission check.
- [ ] The two internal routes (`/internal/payroll/prepare`, `/internal/payroll/send-slips`) are confirmed unchanged, matching D2.
- [ ] `employee.routes.ts`'s in-handler `PAYROLL_VIEW` field check is confirmed unchanged.
- [ ] Route-level tests prove the full outcome matrix (200 / `403 CAPABILITY_NOT_ENABLED` / `403 FORBIDDEN` / `503` / `401` / tenant isolation) for at least the payroll-run-creation route.
- [ ] Full `apps/hr-service` test suite passes with zero new failures beyond the pre-existing `JWT_ISSUER` class.
- [ ] `web-frontend`'s `HR & PAYROLL` nav group's payroll-specific node (not the whole group) carries `capabilityKey: 'HR_PAYROLL'`; a test proves non-payroll HR nav items (Employees, Attendance, Leave) are unaffected by the capability's state.
- [ ] If D1 → backfill: every `ENTERPRISE`-plan tenant's `hr.payroll.enabled` row matches `plan_entitlements`, verified by direct SQL, including tenant-1-shaped gaps (a plan-entitled tenant with no prior row at all).
- [ ] `erp_capability_check_denied_total{capability_key="HR_PAYROLL"}` confirmed incrementing correctly on a real denial (integration test or manual verification against real infra).

## Phase 3B — POS

- [ ] All 12 routes in `pos.routes.ts`, both routes in `day-end.routes.ts`, and the one route in `promotion.routes.ts` gain `requireCapability('POS', ...)` before their existing permission check.
- [ ] Route-level tests prove the full outcome matrix for at least `POST /pos/sales` and one Z-report route.
- [ ] The three flagged existing test files (`pos-completion.test.ts`, `pos-sessions-active.integration.test.ts`, `offline02-pos-sale-idempotency.test.ts`) pass with their fixtures updated to set `pos.enabled: true` for their test tenant — not merely "still pass by coincidence."
- [ ] Full `apps/sales-service` test suite passes with zero new failures beyond the pre-existing `JWT_ISSUER` class.
- [ ] `pos-frontend` handles a `403 CAPABILITY_NOT_ENABLED` response gracefully (user-visible message, not a crash/generic error) — verified by manual smoke test at minimum, per CLAUDE.md's UI-testing requirement.
- [ ] If D1 → backfill: every `GROWTH`/`ENTERPRISE`-plan tenant's `pos.enabled` row matches `plan_entitlements`, including tenant-1-shaped gaps.
- [ ] `InvoiceService.confirm()`'s non-POS call path (via `invoice.routes.ts`) confirmed unaffected — a non-POS invoice creation test passes unchanged.

## Database / migration acceptance (only if D1 → backfill)

- [ ] Migration is idempotent — re-running it produces the same end state.
- [ ] Zero `STARTER`-plan tenant ends up with either flag `true` unless independently confirmed to have real pre-existing usage (the residual-risk case `25-decision-record.md` D1 names explicitly).
- [ ] `plan_entitlements` seed data for all three plans independently re-verified to include the intended flags before the migration ships (closes `10-entitlement-impact.md`'s `TO VERIFY`).

## Security acceptance

- [ ] `15-security-impact.md`'s full checklist re-run against the actual diff, not merely assumed to still hold from Phase 1/2B's prior runs.
- [ ] No new trusted header, no new audit-log write, confirmed by `git diff` scope check (matches Phase 1/2B's own "confirm nothing outside the intended file list changed" step).

## Observability acceptance

- [ ] `erp_capability_check_denied_total` confirmed labelled correctly (`capability_key: 'HR_PAYROLL'|'POS'`) for both sub-phases, in a real (not mocked) test run.

## Backward compatibility acceptance

- [ ] For every tenant whose flag already/now correctly matches its plan: zero response-shape change, zero new error, proven by a dedicated before/after test per `17-migration-and-backward-compatibility.md`.
- [ ] The honest scope of this claim (not "zero change for all tenants," but "zero change for correctly-entitled tenants") is preserved in whatever summary a reviewer reads — do not let this get rounded up during implementation.

## Definition of Done (both sub-phases)

Both sub-phases' criteria above are checked, D1/D1b/D2/D3 are resolved (not merely proposed), the full regression suite is green, `erp_capability_check_denied_total` is confirmed live and correctly labelled, and a post-implementation review (mirroring `21-post-implementation-review.md`/`41-phase-2b-closure-review.md`'s independent-re-verification standard) confirms all of the above against live code and — where D1 required it — live infrastructure, not merely against this document's claims.
