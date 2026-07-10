# Execution Order — Run These in Sequence

One numbered list, 1–58. Open a **fresh session per number**, point it at the linked file (its "Context Preservation" footer is self-contained — no need to paste prior conversation). Check the box when it's actually merged and verified, not just implemented.

This order respects every package's "Depends on" field, plus real file-overlap sequencing found during research (e.g. #6/#7/#8/#9 touch the same `event-service` route files #10 later edits — doing #10 first would create a merge conflict with itself). It is NOT the same as folder order (001–016) — folder order is just a filing scheme.

Before starting **any** numbered item, re-verify its "Current implementation" claims against live code first — this backlog was written 2026-07-08/09 and concurrent work may have already closed some of it (see package's own "Context Preservation → Known Constraints").

---

## Phase 0 — Critical (live security exposures + fake features; do these first, no exceptions)

- [x] **1.** [002-Security/01-tenant-suspension-enforcement.md](002-Security/01-tenant-suspension-enforcement.md) — PG-012 — DONE 2026-07-09: relocated the enforcement logic from tenant-service's never-registered `createTenantContextMiddleware` into a new shared `packages/platform-sdk/src/tenantStatus.ts` (`assertTenantActive`/`initTenantStatusEnforcement`/`invalidateTenantStatusCache`), since the original design (a global Fastify hook) couldn't actually work — `authenticate` is wired per-route via `preHandler` arrays in this codebase, not as a global hook, so a global tenant-check would run *before* auth populates `request.auth` on every request, including protected ones. Folded the check into each service's own `authenticate.ts` instead (runs only on routes that already require auth — public routes need no exemption list at all, unlike the original's hardcoded `/health`/`/admin/tenants` skip-list). Wired into all 14 services (13 + tenant-service itself; api-gateway excluded, still a stub per PG-001). Added `TenantClosedError` (410) alongside the existing `TenantSuspendedError` (403) in `@erp/types`. Platform operators (`PLATFORM_TENANT_MANAGE`) are exempt by permission check, not by URL path — they're scoped to a reserved "platform-operations" tenant that should never be suspendable-into-lockout. `assertTenantActive` fails open (logs once, no-op) if called before `initTenantStatusEnforcement()` — needed because dozens of pre-existing route tests boot a bare Fastify app around `authenticate` without full `main.ts` bootstrap; real service bootstrap always initializes first. Verified via: new unit tests (`packages/platform-sdk/src/__tests__/tenantStatus.test.ts`, 7 tests), a new registration regression guard (`tenantStatus-registration.test.ts`, 28 tests — the acceptance criterion asking for a CI guard against this exact registration gap recurring), full test suites re-run clean on sales/accounting/auth/hr/event/tenant-service (2 pre-existing, unrelated failures confirmed via revert-and-diff: auth-service login/lockout tests and hr-service holiday-seed test, neither touches `authenticate.ts` — one is fully mocked out). Frontend: both `web-frontend` and `pos-frontend` now redirect to a dedicated `/account-suspended` screen instead of a generic error toast.
- [x] **2.** [002-Security/02-organization-branches-permission-fix.md](002-Security/02-organization-branches-permission-fix.md) — PG-013 *(live GSTIN/PAN/bank-detail leak)* — DONE 2026-07-09: scope narrower than written. `GET /organization` now redacts gstin/pan/tan/cin/bankDetails for callers without ORGANIZATION_VIEW (kept authenticate-only, not fully gated — TenantThemeSync calls this for every session to sync branding, so blanket-gating would've broken branding for every non-admin role). POS UPI-QR already had its own narrow, permission-gated endpoint (`GET /pos/upi-vpa` in sales-service) — the prompt's premise that POS reads full `/organization` was stale. Left `/branches`/`/branches/:id` untouched: a more recent audit (ES-33/34/35, see `route-guard-coverage.test.ts` KNOWN_EXCEPTIONS) already deliberately reviewed and whitelisted them as intentional reference-data reads; branches carry no bank details, and many existing dropdown consumers depend on open access. Tests: `apps/tenant-service/src/__tests__/organization-permission.test.ts`.
- [x] **3.** [002-Security/03-rbac-dead-permission-constants.md](002-Security/03-rbac-dead-permission-constants.md) — PG-014 *(touches same files as #2 — do right after, not parallel)* — DONE 2026-07-09: resolved all 16 named-dead constants (retired 15: ORGANIZATION_UPDATE/ORGANIZATION_SETTINGS_UPDATE/ORGANIZATION_SETTINGS_VIEW [found as a bonus 3rd duplicate, not in original list]/BRANCH_CREATE/BRANCH_UPDATE/BRANCH_DELETE/BRANCH_ASSIGN_USER/USER_ACTIVATE/USER_DEACTIVATE/USER_RESET_PASSWORD/APPROVAL_VIEW/APPROVAL_APPROVE/APPROVAL_REJECT/WORKFLOW_CONFIG/CONFIG_VIEW/CONFIG_UPDATE; wired ORGANIZATION_VIEW via PG-013's fix; fixed BRANCH_SCOPE_BYPASS from a bare string literal to the real constant reference in `packages/platform-sdk/src/auth.ts`). role-defaults.ts needed zero changes — none of these 16 were ever explicitly referenced there (only reachable via OWNER/ADMIN's full-permission wildcard), so no backfill migration was needed for the retirements. Frontend nav-gate + route guard for Organization Settings switched from the dead ORGANIZATION_SETTINGS_VIEW to the live ORGANIZATION_VIEW, closing the exact frontend/backend mismatch PG-013 flagged. **Bigger finding, out of scope here:** the CI regression-guard scan (`packages/shared-types/src/__tests__/dead-permission-constants.test.ts`) turned up **63 more** dead constants beyond this package's named list (e.g. `CUSTOMER_STATEMENT_VIEW`, `POS_ACCESS`, `ITEM_UPDATE`) — allowlisted in that test as documented pre-existing debt (do not add to it going forward), but this needs its own dedicated PG-014-shaped remediation phase given the scale (~4x this package's scope). Recommend adding it as a new backlog item.
- [ ] **4.** [002-Security/04-frontend-permission-constants-shared-import.md](002-Security/04-frontend-permission-constants-shared-import.md) — PG-016 *(depends on #3)*
- [ ] **5.** [002-Security/05-password-reset-email-delivery.md](002-Security/05-password-reset-email-delivery.md) — PG-017
- [ ] **6.** [001-Architecture/06-saga-orchestration-registration.md](001-Architecture/06-saga-orchestration-registration.md) — PG-006
- [ ] **7.** [001-Architecture/07-dlq-real-replay.md](001-Architecture/07-dlq-real-replay.md) — PG-007
- [ ] **8.** [001-Architecture/08-projection-rebuild-real-implementation.md](001-Architecture/08-projection-rebuild-real-implementation.md) — PG-008
- [ ] **9.** [001-Architecture/09-export-job-real-implementation.md](001-Architecture/09-export-job-real-implementation.md) — PG-009
- [ ] **10.** [002-Security/10-event-service-dlq-saga-permission-granularity.md](002-Security/10-event-service-dlq-saga-permission-granularity.md) — PG-015 *(same event-service route files as #6–#9 — must come after them)*

## Phase 1 — Security Hardening

- [ ] **11.** [002-Security/11-impersonation-frontend-ui.md](002-Security/11-impersonation-frontend-ui.md) — PG-018
- [ ] **12.** [002-Security/12-orphaned-audit-logs-route.md](002-Security/12-orphaned-audit-logs-route.md) — PG-019
- [ ] **13.** [001-Architecture/13-vault-secrets-integration.md](001-Architecture/13-vault-secrets-integration.md) — PG-004
- [ ] **14.** [003-Infrastructure/14-alerting-on-prometheus-metrics.md](003-Infrastructure/14-alerting-on-prometheus-metrics.md) — PG-023
- [ ] **15.** [002-Security/15-sso-oauth-saml.md](002-Security/15-sso-oauth-saml.md) — PG-020 *(only if a real deal needs it now — otherwise defer to #58 area, it's genuinely Phase 9 work)*

## Phase 2 — Infrastructure Foundation

- [ ] **16.** [003-Infrastructure/16-ci-staging-deploy-real-implementation.md](003-Infrastructure/16-ci-staging-deploy-real-implementation.md) — PG-021
- [ ] **17.** [003-Infrastructure/17-kubernetes-production-readiness.md](003-Infrastructure/17-kubernetes-production-readiness.md) — PG-022 *(XL — has its own multi-session split, see file)*
- [ ] **18.** [003-Infrastructure/18-backup-disaster-recovery.md](003-Infrastructure/18-backup-disaster-recovery.md) — PG-024
- [ ] **19.** [003-Infrastructure/19-centralized-log-aggregation-loki.md](003-Infrastructure/19-centralized-log-aggregation-loki.md) — PG-025
- [ ] **20.** [003-Infrastructure/20-scheduler-log-only-stub-jobs.md](003-Infrastructure/20-scheduler-log-only-stub-jobs.md) — PG-026
- [ ] **21.** [001-Architecture/21-postgres-read-replica-utilization.md](001-Architecture/21-postgres-read-replica-utilization.md) — PG-005

## Phase 3 — Platform Foundation

- [ ] **22.** [001-Architecture/22-api-gateway.md](001-Architecture/22-api-gateway.md) — PG-001 *(XL — has its own 3-session split, see file)*
- [ ] **23.** [001-Architecture/23-shared-cache-package.md](001-Architecture/23-shared-cache-package.md) — PG-002
- [ ] **24.** [001-Architecture/24-event-bus-client-consolidation.md](001-Architecture/24-event-bus-client-consolidation.md) — PG-003
- [ ] **25.** [001-Architecture/25-service-discovery-api-versioning.md](001-Architecture/25-service-discovery-api-versioning.md) — PG-010 *(depends on #22)*
- [ ] **26.** [001-Architecture/26-distributed-transaction-idempotency-standardization.md](001-Architecture/26-distributed-transaction-idempotency-standardization.md) — PG-011
- [ ] **27.** [004-Platform/27-tenant-provisioning-s3-bootstrap.md](004-Platform/27-tenant-provisioning-s3-bootstrap.md) — PG-029
- [ ] **28.** [004-Platform/28-first-platform-operator-bootstrap.md](004-Platform/28-first-platform-operator-bootstrap.md) — PG-030
- [ ] **29.** [004-Platform/29-subscription-billing-license-management.md](004-Platform/29-subscription-billing-license-management.md) — PG-027 *(XL, business decisions needed first — depends on #1)*
- [ ] **30.** [004-Platform/30-usage-tracking-metering.md](004-Platform/30-usage-tracking-metering.md) — PG-028 *(depends on #29)*

## Phase 4 — Business Module Completeness (GST → Accounting → HR → Production → Inventory → Reporting)

- [ ] **31.** [007-GST/31-gstr1-real-excel-export.md](007-GST/31-gstr1-real-excel-export.md) — PG-038
- [ ] **32.** [007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md](007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md) — PG-039
- [ ] **33.** [007-GST/33-gstr9-real-tax-paid-tracking.md](007-GST/33-gstr9-real-tax-paid-tracking.md) — PG-040 *(depends on #32)*
- [ ] **34.** [006-Accounting/34-real-income-summary-account.md](006-Accounting/34-real-income-summary-account.md) — PG-033
- [ ] **35.** [006-Accounting/35-cash-flow-investing-financing-sections.md](006-Accounting/35-cash-flow-investing-financing-sections.md) — PG-034
- [ ] **36.** [006-Accounting/36-opening-balance-full-trial-balance-validation.md](006-Accounting/36-opening-balance-full-trial-balance-validation.md) — PG-035
- [ ] **37.** [008-HR/37-biometric-attendance-import.md](008-HR/37-biometric-attendance-import.md) — PG-041
- [ ] **38.** [008-HR/38-employee-photo-document-upload.md](008-HR/38-employee-photo-document-upload.md) — PG-042
- [ ] **39.** [008-HR/39-bulk-employee-attendance-import.md](008-HR/39-bulk-employee-attendance-import.md) — PG-043
- [ ] **40.** [008-HR/40-multi-state-professional-tax.md](008-HR/40-multi-state-professional-tax.md) — PG-044
- [ ] **41.** [008-HR/41-payroll-loan-deductions.md](008-HR/41-payroll-loan-deductions.md) — PG-045
- [ ] **42.** [009-Production/42-reorder-auto-po-real-gst-rate.md](009-Production/42-reorder-auto-po-real-gst-rate.md) — PG-046
- [ ] **43.** [005-Inventory/43-remove-dead-stock-stub-endpoint.md](005-Inventory/43-remove-dead-stock-stub-endpoint.md) — PG-031
- [ ] **44.** [005-Inventory/44-true-per-warehouse-valuation.md](005-Inventory/44-true-per-warehouse-valuation.md) — PG-032
- [ ] **45.** [011-Reporting/45-scheduled-report-distributed-lock.md](011-Reporting/45-scheduled-report-distributed-lock.md) — PG-048

## Phase 5 — UI/UX Improvements

- [ ] **46.** [013-POS/46-pos-shift-cash-drawer-ui.md](013-POS/46-pos-shift-cash-drawer-ui.md) — PG-050
- [ ] **47.** [013-POS/47-pos-branch-picker-ui.md](013-POS/47-pos-branch-picker-ui.md) — PG-051
- [ ] **48.** [013-POS/48-pos-native-hardware-integration.md](013-POS/48-pos-native-hardware-integration.md) — PG-052
- [ ] **49.** [014-Web/49-mobile-responsiveness-audit.md](014-Web/49-mobile-responsiveness-audit.md) — PG-053
- [ ] **50.** [010-Notifications/50-configurable-quiet-hours.md](010-Notifications/50-configurable-quiet-hours.md) — PG-047

## Phase 6 — Performance & Scale

- [ ] **51.** [012-Search/51-search-horizontal-scaling.md](012-Search/51-search-horizontal-scaling.md) — PG-049

## Phase 7 — Testing

- [ ] **52.** [015-Testing/52-e2e-coverage-expansion.md](015-Testing/52-e2e-coverage-expansion.md) — PG-054
- [ ] **53.** [015-Testing/53-load-performance-testing-harness.md](015-Testing/53-load-performance-testing-harness.md) — PG-055
- [ ] **54.** [015-Testing/54-recurring-chaos-engineering-cadence.md](015-Testing/54-recurring-chaos-engineering-cadence.md) — PG-056

## Phase 8 — Production Readiness

- [ ] **55.** [016-Deployment/55-production-deployment-runbook-rollback.md](016-Deployment/55-production-deployment-runbook-rollback.md) — PG-057 *(depends on #16, #17)*

## Phase 9 — Enterprise Enhancements (defer freely — not production blockers)

- [ ] **56.** [016-Deployment/56-blue-green-canary-release-strategy.md](016-Deployment/56-blue-green-canary-release-strategy.md) — PG-058 *(depends on #55)*
- [ ] **57.** [006-Accounting/57-multi-currency-support.md](006-Accounting/57-multi-currency-support.md) — PG-036 *(XL — only build if a real customer needs it)*
- [ ] **58.** [006-Accounting/58-departments-cost-centers.md](006-Accounting/58-departments-cost-centers.md) — PG-037

---

**Progress tracking:** check boxes off as each item lands, don't just mark complete on "implemented" — verify per that file's own Acceptance Criteria first. If a session finds the gap already partially/fully closed by concurrent work, mark it done here anyway and note what was found, rather than re-implementing.
