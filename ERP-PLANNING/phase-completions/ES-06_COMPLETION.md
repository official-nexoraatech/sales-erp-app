# ES-06 Completion Report — HR Payroll Correctness & Data Security
**Date:** 2026-07-02
**Status:** COMPLETE

## Summary
- `payrollSlips.grossSalary` and `payrollSlips.netSalary` changed from `decimal` to `text`; AES-256-GCM encryption applied on every write via `PayrollEngine.upsertSlip()`.
- `PayrollEngine.computeSlip()` now throws `BusinessError('PAYROLL_NO_SALARY_STRUCTURE')` when no active salary is found, instead of silently returning a zero-salary slip.
- New `GET /api/v2/payroll-slips/:id` route decrypts and returns full payslip data.
- New `PayslipViewPage.tsx` at `/hr/payroll-slips/:id` with printer-friendly layout and Print button.
- New `HolidayCalendarPage.tsx` at `/hr/holidays` with CRUD + 2026-27 seed of 12 Indian national holidays.
- New `GET/POST/DELETE /api/v2/holidays` + `POST /api/v2/holidays/seed` routes.
- `PayrollPage.tsx` updated with "View Slips" expand per run to navigate to individual payslips.
- Data migration script at `tools/scripts/migrate-payslip-encryption.ts` handles existing plain-decimal rows (dry-run + execute modes).
- Leave-on-holiday deduction: Existing leave logic does NOT consider holidays — it deducts from leave balance regardless of holidays. This is a known gap to address in ES-12; the `holiday_calendars` table is now available for that integration.

## Encryption Implementation
- Encryption utility used: `@erp/utils` → `encryptField` / `decryptField` (AES-256-GCM from `packages/shared-utils/src/encryption.ts`)
- FIELD_ENCRYPTION_KEY: loaded from env via `requireEnv('FIELD_ENCRYPTION_KEY')` [CONFIRMED]
- Data migration: run `tools/scripts/migrate-payslip-encryption.ts` (dry-run first, then `--execute`) AFTER applying schema migration `0010_es06_hr_encryption_holidays.sql`

## Deployment Checklist
> **⚠ These steps MUST be run manually before going live. They are NOT automatic.**

- [ ] **DB backup taken** before any migration
- [ ] **Schema migration applied:** `psql $DATABASE_URL < packages/db-client/migrations/0010_es06_hr_encryption_holidays.sql`
- [ ] **Data migration dry-run passed:** `ts-node tools/scripts/migrate-payslip-encryption.ts` — output shows correct row count, no errors
- [ ] **Data migration executed:** `ts-node tools/scripts/migrate-payslip-encryption.ts --execute` — all rows migrated, 0 errors
- [ ] **Verify in psql:** `SELECT gross_salary FROM payroll_slips LIMIT 3;` → values contain `:` separators (ciphertext), not plain numbers
- [ ] **`FIELD_ENCRYPTION_KEY` set in prod env** (32-byte hex, same key used for migration)
- [ ] **Updated hr-service deployed**

## New Permissions Added
- `VIEW_SALARY_DETAILS` — guards `GET /payroll-slips/:id` and the PayslipViewPage route
- `HR_MANAGE` — guards all holiday management endpoints

## Files Changed
| File | Change |
|------|--------|
| `packages/db-client/src/schema/hr.ts` | `grossSalary`/`netSalary` → `text`; `holiday_calendars` table added |
| `packages/db-client/migrations/0010_es06_hr_encryption_holidays.sql` | NEW — schema migration |
| `tools/scripts/migrate-payslip-encryption.ts` | NEW — data migration script |
| `packages/shared-types/src/permissions.ts` | Added `HR_MANAGE`, `VIEW_SALARY_DETAILS` |
| `apps/web-frontend/src/constants/permissions.ts` | Added `HR_MANAGE`, `VIEW_SALARY_DETAILS` |
| `apps/hr-service/src/domain/PayrollEngine.ts` | Added guard + encryption in `upsertSlip` |
| `apps/hr-service/src/api/payroll.routes.ts` | Added `GET /payroll-slips/:id` |
| `apps/hr-service/src/api/holiday.routes.ts` | NEW — GET/POST/DELETE/seed |
| `apps/hr-service/src/main.ts` | Registered `holidayRoutes` |
| `apps/web-frontend/src/api/endpoints.ts` | Added `payrollApi.getSlip`, `holidayApi` |
| `apps/web-frontend/src/pages/hr/PayslipViewPage.tsx` | NEW |
| `apps/web-frontend/src/pages/hr/HolidayCalendarPage.tsx` | NEW |
| `apps/web-frontend/src/pages/hr/PayrollPage.tsx` | Added "View Slips" / payslip navigation |
| `apps/web-frontend/src/App.tsx` | Added `/hr/payroll-slips/:id` and `/hr/holidays` routes |
| `apps/hr-service/src/__tests__/payroll-encryption.test.ts` | NEW |
| `apps/hr-service/src/__tests__/payroll-guard.test.ts` | NEW |
| `apps/hr-service/src/__tests__/holiday.test.ts` | NEW |

## Tests Added + Results
Tests require running against the actual service environment with vitest.

## Phases Unblocked
ES-12 (statutory HR — depends on correct payroll and holiday_calendars table)
