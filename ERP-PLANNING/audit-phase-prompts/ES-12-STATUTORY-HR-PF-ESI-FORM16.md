# ES-12 — Statutory HR: PF, ESI & Form 16
## STATUS: 🔴 PENDING
## Sprint: 3 | Effort: 4–5 days | Risk: High
## Depends on: ES-06 (payroll security)
## Unlocks: ES-17

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement statutory payroll compliance — PF (Provident Fund) challan generation, ESI (Employees' State Insurance) calculation, Form 16 data extraction, and TDS on salary.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-06_COMPLETION.md` — payroll security, encryption, holiday calendar
- [ ] Read `apps/hr-service/src/domain/PayrollEngine.ts` — full file
- [ ] Read `packages/db-client/src/schema/hr.ts` — all HR table columns
- [ ] Check existing salary structure configuration (find where Basic, HRA, components are stored)
- [ ] Check if `employee_statutory` table exists for PF number, UAN, ESI number
- [ ] Check if `salary_structures` table has components array or separate table
- [ ] Read `apps/hr-service/src/api/payroll.routes.ts`
- [ ] Read `apps/web-frontend/src/pages/hr/` — existing pages
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-06 ✅ | HR Security | Payroll encryption, payroll guard, holiday calendar |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | AES-256-GCM (ES-06) |
React 18 + Vite 5 + Tailwind v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`

### Money Rules
- ALL amounts in paise (integers)
- PF/ESI calculations: always integer arithmetic, never floats

### India Statutory Payroll Domain Rules
```
PF (Provident Fund):
  Employee contribution: 12% of Basic + DA (capped at ₹15,000 basic; so max ₹1,800/month)
  Employer contribution: 12% of Basic + DA
    - EPS (Pension): 8.33% capped at ₹1,250/month (₹15,000 × 8.33%)
    - EPF (actual PF): 12% - EPS portion
  Applies to: all employees earning gross ≤ ₹15,000 (mandatory); optional for higher earners
  UAN (Universal Account Number): required field for each employee

ESI (Employees' State Insurance):
  Applicable: employees with gross salary ≤ ₹21,000/month
  Employee contribution: 0.75% of gross salary
  Employer contribution: 3.25% of gross salary
  ESI number: required field for each applicable employee

TDS on Salary (Section 192):
  Calculate annual projected salary
  Apply income tax slabs:
    - Up to ₹3,00,000: NIL (new regime 2024-25)
    - ₹3,00,001–₹7,00,000: 5%
    - ₹7,00,001–₹10,00,000: 10%
    - ₹10,00,001–₹12,00,000: 15%
    - ₹12,00,001–₹15,00,000: 20%
    - Above ₹15,00,000: 30%
  Monthly TDS = Annual Tax Liability / 12 (adjusted for mid-year joiners)
  Standard deduction: ₹75,000 from FY 2024-25

Form 16:
  Part A: TDS certificate (from TRACES — outside scope, but data extraction required)
  Part B: Salary details, deductions, gross total income, tax payable
  Generated annually per employee after year-end
  Data source: all payroll_slips for employee for the financial year

PF Challan:
  Monthly filing: due by 15th of following month
  Format: summary of all employees with UAN + contribution amounts
  Export format: Excel/CSV compatible with EPFO portal
```

### Auth Pattern
```typescript
fastify.get('/hr/pf-challans/:month', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)],
}, handler)
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- All salary data: decrypt before calculation (from ES-06)
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. PF calculation during payroll run (Employee + Employer)
2. ESI calculation during payroll run (Employee + Employer)
3. TDS on salary (Section 192)
4. PF Challan generation and export
5. Form 16 data extraction
6. Employee statutory details management (UAN, ESI number)

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Employee statutory fields**

`packages/db-client/src/schema/hr.ts`:
Ensure `employees` table has (add via migration if missing):
```sql
uan VARCHAR(20),              -- Universal Account Number (PF)
esi_number VARCHAR(17),       -- ESI IP number
pf_applicable BOOLEAN NOT NULL DEFAULT true,
esi_applicable BOOLEAN NOT NULL DEFAULT true,
```

Migration: `000X_es12_hr_statutory_fields.sql`

Frontend: `apps/web-frontend/src/pages/hr/EmployeeStatutoryPage.tsx` (or add tab to employee detail page)
- UAN, ESI Number, PF opt-out toggle, ESI opt-out toggle

**Step 2 — PF + ESI in PayrollEngine**

`apps/hr-service/src/domain/PayrollEngine.ts`:

Add to the payroll calculation for each employee:
```typescript
// PF Calculation
const basicForPF = Math.min(employee.basicSalary, 1500000); // ₹15,000 cap in paise
const employeePF = employee.pfApplicable ? Math.round(basicForPF * 12 / 100) : 0;
const eps = employee.pfApplicable ? Math.min(Math.round(basicForPF * 833 / 10000), 125000) : 0; // 8.33% capped at ₹1,250
const employerPF = employee.pfApplicable ? (Math.round(basicForPF * 12 / 100) - eps) : 0; // EPF portion

// ESI Calculation
const grossMonthly = ...;  // sum of all earning components
const esiApplicable = employee.esiApplicable && grossMonthly <= 2100000; // ₹21,000 in paise
const employeeESI = esiApplicable ? Math.round(grossMonthly * 75 / 10000) : 0; // 0.75%
const employerESI = esiApplicable ? Math.round(grossMonthly * 325 / 10000) : 0; // 3.25%

// TDS (Section 192)
const annualGross = grossMonthly * 12; // project annual salary
const standardDeduction = 7500000; // ₹75,000 in paise
const taxableIncome = Math.max(0, annualGross - standardDeduction);
const annualTDS = calculateIncomeTax(taxableIncome); // see slabs above
const monthlyTDS = Math.round(annualTDS / 12);
```

Store in `payroll_slips` (add columns):
- `employee_pf` BIGINT, `employer_pf` BIGINT, `eps_amount` BIGINT
- `employee_esi` BIGINT, `employer_esi` BIGINT
- `monthly_tds` BIGINT
- `net_salary` = gross - employee_pf - employee_esi - monthly_tds - other_deductions

**Step 3 — PF Challan generation**

`apps/hr-service/src/domain/PFChallanService.ts` (new file):

`generateChallan(tenantId, month, year, ctx)`:
- Aggregate all employees' PF for the given month
- Return: array of `{ uan, employeeName, basicSalary, epfEmployee, epfEmployer, epsAmount }` rows
- Also return: totals

Route: `GET /api/v1/hr/pf-challans?month=07&year=2026`
Guard: `authenticate` + `requirePermission(PERMISSIONS.HR_STATUTORY)`

Route: `GET /api/v1/hr/pf-challans/export?month=07&year=2026&format=csv`
Response: CSV file download formatted for EPFO portal

Frontend: `apps/web-frontend/src/pages/hr/PFChallanPage.tsx`
- Month/Year picker
- `ERPDataGrid`: Employee, UAN, Basic, EPF Employee, EPF Employer, EPS
- Summary totals row
- "Download for EPFO Portal" button → CSV
- "Mark as Filed" button → updates `pf_challans.filed_at`

**Step 4 — ESI Challan**

Same pattern as PF Challan but for ESI.

`apps/hr-service/src/domain/ESIChallanService.ts` (new file):
- Route: `GET /api/v1/hr/esi-challans?month=07&year=2026`
- Export CSV for ESIC portal

Frontend: `apps/web-frontend/src/pages/hr/ESIChallanPage.tsx`

**Step 5 — Form 16 data extraction**

`apps/hr-service/src/domain/Form16Service.ts` (new file):

`generateForm16Data(employeeId, financialYear, ctx)`:
- Query all `payroll_slips` for this employee for the financial year
- Decrypt `grossSalary` + `netSalary` for each month (ES-06 encryption)
- Return Part B data:
  ```typescript
  {
    employeeName, pan, employerName, employerTAN,
    grossSalary: totalAnnualGross,
    standardDeduction: 75000,
    taxableIncome,
    totalTDSDeducted,
    monthlyBreakdown: [{ month, gross, tds, pf, esi }]
  }
  ```

Route: `GET /api/v1/hr/employees/:id/form16?year=2025-26`
Guard: `requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)` (from ES-07)

Frontend: `apps/web-frontend/src/pages/hr/Form16Page.tsx`
- Employee selector
- FY selector
- Summary: Gross Salary, Standard Deduction, Taxable Income, Total TDS
- Month-by-month breakdown table
- "Download" button → JSON or PDF (if PDF rendering available)

### OUT OF SCOPE
- TRACES integration (actual TDS certificate download — requires government API)
- PF account balance lookup (requires EPFO API)
- ESI claim processing
- Biometric integration for attendance

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/hr-service/src/__tests__/statutory-payroll.test.ts`:
1. Employee with basic ₹20,000 → EPF employee = ₹1,800 (12% × ₹15,000 cap)
2. Employee with basic ₹10,000 → EPF employee = ₹1,200 (12% × ₹10,000)
3. Employee with gross ₹22,000 → ESI NOT applicable (over ₹21,000 limit)
4. Employee with gross ₹18,000 → ESI employee = ₹135 (0.75% × ₹18,000)
5. Annual taxable income ₹7,00,000 → correct tax = ₹25,000 per new regime slabs
6. Annual taxable income ₹5,00,000 → tax = 5% × ₹2,00,000 = ₹10,000
7. PF challan: correct totals for 10-employee test run
8. Form 16: gross salary matches sum of all monthly payslips (decrypted)

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

- [ ] PF calculation correct for both capped and uncapped basic salaries
- [ ] ESI not applied for employees with gross > ₹21,000
- [ ] `payroll_slips` rows have `employee_pf`, `employer_pf`, `employee_esi`, `monthly_tds` populated
- [ ] PF Challan page shows correct monthly totals
- [ ] CSV export downloads with EPFO-compatible format
- [ ] Form 16 data shows correct annual gross and total TDS
- [ ] All 8 tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Payroll run for existing employees still works (ES-06 encryption intact)
- [ ] Payslip view page still shows correct gross and net amounts (ES-06)
- [ ] Holiday calendar still functioning (ES-06)
- [ ] No regression in employee CRUD

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] PF (Employee + Employer) calculated in every payroll run
- [ ] ESI calculated for applicable employees
- [ ] TDS calculated monthly
- [ ] PF Challan exportable as CSV
- [ ] ESI Challan page working
- [ ] Form 16 data extractable per employee per FY
- [ ] 8 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-12_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-12_COMPLETION.md`

```markdown
# ES-12 Completion Report — Statutory HR
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Statutory Calculations
- PF cap used: ₹15,000 basic → max EPF = ₹1,800/month
- ESI eligibility cap: gross ≤ ₹21,000
- TDS slabs: FY 2024-25 new regime applied

## Income Tax Slabs Used
[Document exactly which slabs were implemented]

## Files Changed
[Table]

## Data Migration
- Existing payroll_slips without PF/ESI columns: [migration ran / manual update needed]

## Tests: 8/8 PASS | lint: PASS | build: PASS
```
