# ES-06 — HR Payroll Correctness & Data Security
## STATUS: 🔴 PENDING
## Sprint: 2 | Effort: 3–4 days | Risk: Medium
## Depends on: None (independent)
## Unlocks: ES-12

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: encrypt payslip salary columns, add payroll guard, add individual payslip view, and implement Holiday Calendar.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-01-SECURITY-ROUTING-FIXES.md`
- [ ] Read `packages/db-client/src/schema/hr.ts` — find `payroll_slips` table; check if `grossSalary`/`netSalary` are encrypted
- [ ] Read `apps/hr-service/src/domain/PayrollEngine.ts` — understand how payroll is calculated
- [ ] Read `packages/platform-sdk/src/` — find existing AES-256-GCM encryption utility
- [ ] Read `packages/shared-utils/src/` — check for any crypto utilities
- [ ] Read `apps/hr-service/src/api/payroll.routes.ts` — existing routes
- [ ] Read `apps/web-frontend/src/pages/hr/PayrollPage.tsx` — current payroll UI
- [ ] Confirm: `FIELD_ENCRYPTION_KEY` env var exists in `.env` and `.env.example`
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | rate limit, JWT for search |
| ES-02–05 | Check reports | No direct impact on HR |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM |
AES-256-GCM field encryption | React 18 + Vite 5 + Tailwind v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`

### Security: Field Encryption
- The `FIELD_ENCRYPTION_KEY` env var holds the AES-256-GCM key (must be 32 bytes)
- Encrypt on write (in domain service layer), decrypt on read (transparently)
- NEVER encrypt/decrypt in route handlers or repositories
- NEVER hardcode the encryption key
- Use the EXISTING encryption utility (find it in `platform-sdk` or `shared-utils`) — do NOT create a new one
- Pattern: `encryptField(value, key): string` → stores ciphertext; `decryptField(ciphertext, key): string` → returns plaintext

### Auth Pattern
```typescript
fastify.get('/hr/payroll-slips/:id', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)],
}, handler)
```

### Frontend Design System (MANDATORY)
- `ERPDataGrid` for tabular data
- `ERPFormField` + `ERPInput` for forms
- `ERPSkeleton` for loading states
- `useToast()` for notifications
- `ERPPageHeader` for page titles
- `ERPErrorBoundary` wrapping each page

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Errors: typed classes from `packages/shared-types/src/errors.ts`
- Error codes: `PAYROLL_NO_SALARY_STRUCTURE`, `HR_HOLIDAY_DUPLICATE`, etc.
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

Fix four HR/Payroll gaps:
1. Encrypt `payrollSlips.grossSalary` and `payrollSlips.netSalary` (currently plain decimal)
2. Guard `PayrollEngine` against zero-salary for employees without salary structure
3. Add individual payslip view page
4. Add Holiday Calendar master

**Why critical:** Salary data is sensitive personal information. Plain decimal columns in `payroll_slips` expose every employee's salary to anyone with database read access (DBA, hosting provider, backup restore). This is a legal data protection risk.

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Fix 1 — Encrypt payslip salary columns**

Schema change (`packages/db-client/src/schema/hr.ts`):
- Change `grossSalary` and `netSalary` columns from `decimal/numeric` → `text` (to store encrypted ciphertext)
- Add `holiday_calendars` table (see Fix 4)
- Migration: `packages/db-client/migrations/000X_es06_hr_encryption_holidays.sql`

Data migration for existing rows:
- Write a Node.js script: `tools/scripts/migrate-payslip-encryption.ts`
- Mode 1 (dry-run): read all rows, encrypt, print what would be written (no DB write)
- Mode 2 (execute): encrypt all existing `payroll_slips.grossSalary` and `netSalary` rows in-place
- **Before running execute mode:** Create a DB backup — document this in the deployment runbook
- The script must verify decryption works before writing (read → encrypt → decrypt → verify matches original)

`apps/hr-service/src/domain/PayrollEngine.ts`:
- All writes: encrypt `grossSalary` and `netSalary` before inserting into DB
- All reads: decrypt `grossSalary` and `netSalary` before returning to callers
- Use the EXISTING encryption utility from `packages/platform-sdk` or `packages/shared-utils`

**Fix 2 — Payroll guard for missing salary structure**

`apps/hr-service/src/domain/PayrollEngine.ts`:
- At the START of the payroll calculation for each employee:
  ```typescript
  if (!employee.salaryStructureId) {
    throw new ERPError('PAYROLL_NO_SALARY_STRUCTURE',
      `Employee ${employee.id} has no salary structure assigned`, 422);
  }
  ```
- The payroll run must fail LOUDLY (not silently produce zero-salary payslips)

**Fix 3 — Individual payslip view**

`apps/hr-service/src/api/payroll.routes.ts`:
- Add: `GET /api/v1/hr/payroll-slips/:id`
- Guard: `authenticate` + `requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)` (this permission is added in ES-07 — use the constant name now, add it to `permissions.ts` in this phase if ES-07 hasn't run yet)
- Return: decrypted `grossSalary`, `netSalary`, plus employee name, designation, pay period, earnings breakdown, deductions breakdown, employer PF contribution
- Verify: the payslip's `tenantId` matches `request.auth.tenantId` before returning (no cross-tenant leak)

New page: `apps/web-frontend/src/pages/hr/PayslipViewPage.tsx`:
- Printer-friendly layout (will look good on `window.print()`)
- Show: employee name, designation, pay period, earnings items and amounts, deductions items and amounts, gross salary (₹), net salary (₹), employer PF contribution
- Print button: `<button onClick={() => window.print()}>Print</button>`
- Route: `/hr/payroll-slips/:id`

`apps/web-frontend/src/pages/hr/PayrollPage.tsx`:
- Add "View Payslip" icon/button in each employee row's action column
- Navigate to `/hr/payroll-slips/:id` on click

**Fix 4 — Holiday Calendar**

Schema (`packages/db-client/src/schema/hr.ts`):
```
holiday_calendars:
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  tenant_id UUID NOT NULL
  name VARCHAR(100) NOT NULL
  holiday_date DATE NOT NULL
  holiday_type VARCHAR(20) NOT NULL  -- 'NATIONAL' | 'STATE' | 'OPTIONAL'
  branch_id UUID (nullable — null means all branches)
  created_at TIMESTAMPTZ DEFAULT NOW()
Index: (tenant_id, holiday_date)
```

`apps/hr-service/src/api/holiday.routes.ts` (new file):
- `GET /api/v1/hr/holidays` — list holidays for tenant (filter by year)
- `POST /api/v1/hr/holidays` — create holiday
- `DELETE /api/v1/hr/holidays/:id` — delete holiday
- All routes: `authenticate` + `requirePermission(PERMISSIONS.HR_MANAGE)` (use existing or appropriate permission)

Leave calculation: Verify if existing leave balance logic considers holidays. If an approved leave day falls on a holiday, it should NOT consume leave balance. Fix if not handled.

New page: `apps/web-frontend/src/pages/hr/HolidayCalendarPage.tsx`:
- `ERPDataGrid`: Holiday Name, Date, Type (National/State/Optional), Branch
- Add Holiday button → inline form or `ERPConfirmModal`-style dialog
- "Seed 2026-27 holidays" button → calls seeding endpoint with a hardcoded list of Indian national holidays for FY 2026-27:
  - Republic Day: Jan 26, 2027
  - Independence Day: Aug 15, 2026
  - Gandhi Jayanti: Oct 2, 2026
  - Diwali: Oct 20, 2026 (approximate — adjust to actual date)
  - Christmas: Dec 25, 2026
  - New Year: Jan 1, 2027
  (Add all Gazetted National Holidays for 2026-27)

### OUT OF SCOPE
- PF/ESI challan generation (ES-12)
- Form 16 / Form 24Q (ES-12)
- Attendance device integration
- Biometric integration

---

## ═══════════════════════════════════════════
## DATABASE RULES
## ═══════════════════════════════════════════

- Migration for schema changes: `packages/db-client/migrations/000X_es06_hr_encryption_holidays.sql`
- The migration changes `grossSalary`/`netSalary` column types — this is safe as the columns currently hold numeric data which will be migrated by the separate script
- Data migration script is separate from the schema migration
- After running schema migration: run data migration script (dry-run first, then execute)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/hr-service/src/__tests__/payroll-encryption.test.ts`:
1. Run payroll for employee with salary structure → `payroll_slips.grossSalary` in DB is NOT a plain number (it's encrypted ciphertext)
2. `GET /api/v1/hr/payroll-slips/:id` → returns decrypted `{ grossSalary: 50000, netSalary: 45000 }` (plain integers)
3. Cross-tenant: GET payslip with wrong tenant JWT → 403 or 404

`apps/hr-service/src/__tests__/payroll-guard.test.ts`:
4. Run payroll for employee WITHOUT salary structure → throws `PAYROLL_NO_SALARY_STRUCTURE` error (422)
5. Run payroll for employee WITH salary structure → succeeds normally

`apps/hr-service/src/__tests__/holiday.test.ts`:
6. Create holiday → holiday exists in list
7. Apply for leave on a holiday date → leave balance not consumed (or verify existing behavior and document)

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/hr-service build
pnpm --filter @erp/hr-service type-check
pnpm --filter @erp/db-client build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/hr-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] `SELECT gross_salary FROM payroll_slips LIMIT 1` in psql → encrypted ciphertext (not a plain number like `50000`)
- [ ] `GET /api/v1/hr/payroll-slips/{id}` → `{ grossSalary: 50000, netSalary: 45000 }` (decrypted integers)
- [ ] Run payroll for employee with NO salary structure → 422 with code `PAYROLL_NO_SALARY_STRUCTURE`
- [ ] Run payroll for employee WITH salary structure → succeeds, payslip created
- [ ] `PayslipViewPage.tsx` renders at `/hr/payroll-slips/:id` with all salary components
- [ ] Print button triggers browser print dialog
- [ ] `HolidayCalendarPage.tsx` renders at `/hr/holidays` with add/delete functionality
- [ ] Seed holidays button creates national holidays for 2026-27
- [ ] Schema migration applied cleanly: `grossSalary` and `netSalary` columns changed to text type
- [ ] Data migration script dry-run shows correct output before execute
- [ ] All new tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Payroll run for employees WITH salary structures still produces correct amounts
- [ ] Existing payroll page (`PayrollPage.tsx`) still loads and shows employee list
- [ ] Leave balance calculation unchanged for non-holiday days
- [ ] Employee create/edit/view flow unchanged
- [ ] Attendance page unaffected

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] `payroll_slips.grossSalary` and `netSalary` encrypted at rest
- [ ] Existing plaintext rows migrated to encrypted form via script
- [ ] Payroll fails loudly for employees without salary structure
- [ ] Individual payslip viewable in UI
- [ ] Holiday calendar manageable by HR admin
- [ ] All tests pass, zero build errors, zero lint warnings
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-06_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-06_COMPLETION.md`

```markdown
# ES-06 Completion Report — HR Payroll Correctness & Data Security
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Summary
[What was encrypted, what guards were added, what UI was built]

## Encryption Implementation
- Encryption utility used: [package + function name]
- FIELD_ENCRYPTION_KEY: loaded from env [CONFIRMED]
- Data migration: ran on [date], [N] rows migrated

## Files Changed
| File | Change |
|------|--------|
| packages/db-client/src/schema/hr.ts | grossSalary/netSalary → text; holiday_calendars added |
| packages/db-client/migrations/000X_es06_hr_encryption_holidays.sql | NEW |
| tools/scripts/migrate-payslip-encryption.ts | NEW |
| apps/hr-service/src/domain/PayrollEngine.ts | Encryption + guard |
| apps/hr-service/src/api/payroll.routes.ts | GET /payroll-slips/:id |
| apps/hr-service/src/api/holiday.routes.ts | NEW |
| apps/web-frontend/src/pages/hr/PayslipViewPage.tsx | NEW |
| apps/web-frontend/src/pages/hr/HolidayCalendarPage.tsx | NEW |
| apps/web-frontend/src/pages/hr/PayrollPage.tsx | Added View Payslip button |

## Tests Added + Results
pnpm test: [PASS] | pnpm lint: [PASS] | pnpm build: [PASS]

## Phases Unblocked
ES-12 (statutory HR — depends on correct payroll)
```
