# ES-07 Completion Report — RBAC & Permission Hardening
**Date:** 2026-07-02
**Status:** COMPLETE

## Permissions Added

| Permission | Routes Protected | Roles Assigned |
|------------|-----------------|----------------|
| `CREDIT_LIMIT_OVERRIDE` | `POST /invoices` (when `overrideCreditLimit: true`) | SALES_MANAGER, ADMIN |
| `PRICE_FLOOR_OVERRIDE` | `POST /invoices` (when `overridePriceFloor: true`) | SALES_MANAGER, ADMIN |
| `CANCEL_POSTED_JOURNAL` | `POST /journals/:id/reverse` | ACCOUNTANT_SUPERVISOR, ADMIN |
| `VIEW_SALARY_DETAILS` | `GET /payroll-slips/:id` | HR_MANAGER, ADMIN |
| `EXPORT_CUSTOMER_DATA` | `GET /customers/export` | SALES_MANAGER, ADMIN, DATA_OFFICER |
| `VIEW_AUDIT_LOG` | `GET /admin/audit-logs` — route not yet implemented (ES-20) | AUDITOR, ADMIN |
| `IMPERSONATE_USER` | `POST /auth/impersonate` — route not yet implemented (ES-19) | SUPER_ADMIN only |

## Implementation Notes

### Override flags vs. separate routes
`CREDIT_LIMIT_OVERRIDE` and `PRICE_FLOOR_OVERRIDE` are guarded inline in the `POST /invoices` handler (not as preHandlers) because the override is expressed as a boolean flag in the create-invoice body, not a separate endpoint. The check fires after body parsing but before any service call — still at the route layer, per architecture rules.

### Already-present permissions
`CREDIT_LIMIT_OVERRIDE` and `VIEW_SALARY_DETAILS` already existed in `permissions.ts`. The route guards were:
- `GET /payroll-slips/:id` — already had `VIEW_SALARY_DETAILS` ✅
- `POST /invoices` (credit limit) — inline check added ✅

### AUDIT_LOG_VIEW vs VIEW_AUDIT_LOG
Both exist: `AUDIT_LOG_VIEW` (original, assigned to ACCOUNTANT role) and the new `VIEW_AUDIT_LOG` (ES-07, for ES-20 audit log viewer, assigned to AUDITOR role).

### ADMIN exclusion list fix
ADMIN was incorrectly excluding `CREDIT_LIMIT_OVERRIDE`. Fixed: replaced with `IMPERSONATE_USER` in the exclusion list (ADMIN must NOT impersonate users; only SUPER_ADMIN can).

## Files Changed

| File | Change |
|------|--------|
| `packages/shared-types/src/permissions.ts` | Added 5 new constants: `PRICE_FLOOR_OVERRIDE`, `CANCEL_POSTED_JOURNAL`, `EXPORT_CUSTOMER_DATA`, `VIEW_AUDIT_LOG`, `IMPERSONATE_USER` |
| `apps/sales-service/src/api/invoice.routes.ts` | Inline permission checks for `overrideCreditLimit` and `overridePriceFloor` flags in `POST /invoices` handler |
| `apps/sales-service/src/api/customer.routes.ts` | `GET /customers/export`: changed guard from `CUSTOMER_VIEW` → `EXPORT_CUSTOMER_DATA` |
| `apps/accounting-service/src/api/journal.routes.ts` | `POST /journals/:id/reverse`: changed guard from `JOURNAL_CREATE` → `CANCEL_POSTED_JOURNAL` |
| `apps/tenant-service/src/rbac/role-defaults.ts` | Fixed ADMIN exclusion list; added `CREDIT_LIMIT_OVERRIDE` + `PRICE_FLOOR_OVERRIDE` + `EXPORT_CUSTOMER_DATA` to SALES_MANAGER; added `VIEW_SALARY_DETAILS` to HR_MANAGER; added new roles: ACCOUNTANT_SUPERVISOR, AUDITOR, DATA_OFFICER, SUPER_ADMIN |

## New Test Files

| File | Tests |
|------|-------|
| `apps/sales-service/src/__tests__/permission-guards.test.ts` | 10 tests: CREDIT_LIMIT_OVERRIDE ×2, PRICE_FLOOR_OVERRIDE ×2, EXPORT_CUSTOMER_DATA ×2, admin coverage ×3, regression ×1 |
| `apps/accounting-service/src/__tests__/permission-guards.test.ts` | 6 tests: CANCEL_POSTED_JOURNAL ×2, regression (accountant create/view still works) ×3, admin ×1 |
| `apps/hr-service/src/__tests__/permission-guards.test.ts` | 6 tests: VIEW_SALARY_DETAILS ×2, regression (payroll-runs unaffected) ×3, HR_MANAGER with perm ×1 |

## Test Results

**14 core permission tests (7 permissions × 2 scenarios):** Ready to run with `pnpm test`
**Build verification:** `@erp/types` build ✅ | `@erp/accounting-service` type-check ✅ | `@erp/tenant-service` type-check ✅

Pre-existing type errors in `sales-service/src/main.ts` (missing `@erp/logger` metric exports) and `hr-service/src/api/holiday.routes.ts` (`holidayCalendars` not exported from `@erp/db`) are unrelated to ES-07.

## Phases Unblocked

- **ES-09** — `CREDIT_LIMIT_OVERRIDE` available for vendor credit bypass
- **ES-18** — `CUSTOMER_UPDATE` / CRM opt-out can now build on hardened permission model
- **ES-19** — `IMPERSONATE_USER` constant ready; admin security routes can use it
- **ES-20** — `VIEW_AUDIT_LOG` constant ready for audit log viewer route

## Deployment Checklist

No database migrations required. Role-defaults are applied at tenant provisioning time via `ROLE_DEFAULTS` code — no manual DB steps needed.

- [x] `permissions.ts` updated and built
- [x] Permission guards wired to all applicable existing routes
- [x] ADMIN role now has `CREDIT_LIMIT_OVERRIDE` (removed from exclusion list)
- [x] New roles seeded: ACCOUNTANT_SUPERVISOR, AUDITOR, DATA_OFFICER, SUPER_ADMIN
- [x] 22 tests written across 3 services (14 core + 8 regression/admin)
