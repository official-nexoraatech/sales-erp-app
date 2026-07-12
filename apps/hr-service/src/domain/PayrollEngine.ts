import { decryptField, encryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';
import type { TenantScopedDatabase } from '@erp/sdk';
import {
  employees,
  employeeSalaries,
  attendance,
  leaveApplications,
  tailorWorkLog,
  payrollSlips,
  branches,
  organizationSettings,
} from '@erp/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { BusinessError } from '@erp/types';
import { PTSlabService } from './PTSlabService.js';
import { EmployeeLoanService, type EmployeeLoanRow } from './EmployeeLoanService.js';

export interface PayrollSlipResult {
  employeeId: number;
  presentDays: number;
  paidLeaveDays: number;
  lopDays: number;
  workingDays: number;
  basicSalary: number;
  hraAmount: number;
  daAmount: number;
  otherAllowances: number;
  pieceRateAmount: number;
  grossSalary: number;
  pfEmployee: number;
  pfEmployer: number;
  epsAmount: number;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  loanDeduction: number;
  tdsDeduction: number;
  totalDeductions: number;
  netSalary: number;
}

const PF_BASIC_CAP = 15000;
const EPS_MONTHLY_CAP = 1250;
const ESI_GROSS_CAP = 21000;

export interface PFResult {
  pfEmployee: number;
  pfEmployer: number;
  epsAmount: number;
}

// PF: employee contributes 12% of basic (capped at ₹15,000 basic).
// Employer's 12% splits into EPS (8.33%, capped ₹1,250) + EPF (remainder).
export function computePF(basic: number, pfApplicable: boolean): PFResult {
  if (!pfApplicable) return { pfEmployee: 0, pfEmployer: 0, epsAmount: 0 };
  const pfBasic = Math.min(basic, PF_BASIC_CAP);
  const pfEmployee = Math.round(pfBasic * 0.12 * 100) / 100;
  const epsAmount = Math.min(Math.round(pfBasic * 0.0833 * 100) / 100, EPS_MONTHLY_CAP);
  const pfEmployer = Math.round((pfEmployee - epsAmount) * 100) / 100;
  return { pfEmployee, pfEmployer, epsAmount };
}

export interface ESIResult {
  esiEmployee: number;
  esiEmployer: number;
}

// ESI: applicable when gross salary <= ₹21,000/month.
export function computeESI(grossSalary: number, esiApplicable: boolean): ESIResult {
  if (!esiApplicable || grossSalary > ESI_GROSS_CAP) return { esiEmployee: 0, esiEmployer: 0 };
  return {
    esiEmployee: Math.round(grossSalary * 0.0075 * 100) / 100,
    esiEmployer: Math.round(grossSalary * 0.0325 * 100) / 100,
  };
}

// Section 192 TDS on salary — FY 2024-25 new regime slabs.
const INCOME_TAX_SLABS = [
  { upTo: 300000, rate: 0 },
  { upTo: 600000, rate: 0.05 },
  { upTo: 900000, rate: 0.1 },
  { upTo: 1200000, rate: 0.15 },
  { upTo: 1500000, rate: 0.2 },
  { upTo: Infinity, rate: 0.3 },
];

export function calculateIncomeTax(taxableIncome: number): number {
  let tax = 0;
  let prevLimit = 0;
  for (const slab of INCOME_TAX_SLABS) {
    if (taxableIncome <= prevLimit) break;
    const taxableInSlab = Math.min(taxableIncome, slab.upTo) - prevLimit;
    tax += taxableInSlab * slab.rate;
    prevLimit = slab.upTo;
  }
  return Math.round(tax);
}

const STANDARD_DEDUCTION = 75000;

export function computeMonthlyTDS(annualGrossSalary: number): number {
  const taxableIncome = Math.max(0, annualGrossSalary - STANDARD_DEDUCTION);
  const annualTax = calculateIncomeTax(taxableIncome);
  return Math.round(annualTax / 12);
}

// Resolves which state's PT slabs apply: the employee's branch state, falling back to the
// tenant's registered (organizationSettings) state when the employee has no branch or the
// branch has no state on file. `cache` lets a payroll run (many employees, few distinct
// branches) resolve each branch's state once instead of once per employee.
export async function resolveEmployeeState(
  db: TenantScopedDatabase,
  tenantId: number,
  branchId: number | null,
  cache?: Map<number | null, string | null>
): Promise<string | null> {
  if (cache?.has(branchId)) return cache.get(branchId) ?? null;

  let state: string | null = null;
  if (branchId != null) {
    const [branchRow] = await db.raw
      .select({ address: branches.address })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.id, branchId)));
    state = branchRow?.address?.state ?? null;
  }
  if (!state) {
    const [orgRow] = await db.raw
      .select({ address: organizationSettings.address })
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));
    state = orgRow?.address?.state ?? null;
  }

  cache?.set(branchId, state);
  return state;
}

// Sums an employee's active loan EMIs, each capped at that loan's own remaining
// outstandingBalance so the final EMI never overshoots. Read-only — balances are only
// decremented at payroll-run approval (EmployeeLoanService.applyMonthlyDeduction), not here,
// since computeSlip can run repeatedly on a still-DRAFT payroll run.
export function computeLoanDeduction(
  activeLoans: Pick<EmployeeLoanRow, 'monthlyDeduction' | 'outstandingBalance'>[]
): number {
  const total = activeLoans.reduce(
    (sum, loan) => sum + Math.min(loan.monthlyDeduction, loan.outstandingBalance),
    0
  );
  return Math.round(total * 100) / 100;
}

export class PayrollEngine {
  static async computeSlip(
    db: TenantScopedDatabase,
    tenantId: number,
    employeeId: number,
    periodMonth: number,
    periodYear: number,
    workingDays: number,
    ptStateCache?: Map<number | null, string | null>
  ): Promise<PayrollSlipResult> {
    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

    // Get active salary
    const [salRow] = await db.raw
      .select()
      .from(employeeSalaries)
      .where(
        and(
          eq(employeeSalaries.tenantId, tenantId),
          eq(employeeSalaries.employeeId, employeeId),
          eq(employeeSalaries.isActive, true)
        )
      );

    if (!salRow) {
      throw new BusinessError(
        'PAYROLL_NO_SALARY_STRUCTURE',
        `Employee ${employeeId} has no active salary assigned`
      );
    }

    const [empRow] = await db.raw
      .select({
        pfApplicable: employees.pfApplicable,
        esiApplicable: employees.esiApplicable,
        branchId: employees.branchId,
      })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId)));
    const pfApplicable = empRow?.pfApplicable ?? true;
    const esiApplicable = empRow?.esiApplicable ?? true;

    const basicFull = parseFloat(decryptField(salRow.basicEncrypted, encKey));
    const hraFull = salRow.hraEncrypted ? parseFloat(decryptField(salRow.hraEncrypted, encKey)) : 0;
    const daFull = salRow.daEncrypted ? parseFloat(decryptField(salRow.daEncrypted, encKey)) : 0;
    const grossFull = parseFloat(decryptField(salRow.grossEncrypted, encKey));

    // Build period date range
    const startDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(periodYear, periodMonth, 0).getDate();
    const endDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${lastDay}`;

    // Count present days from attendance
    const attRows = await db.raw
      .select({ status: attendance.status })
      .from(attendance)
      .where(
        and(
          eq(attendance.tenantId, tenantId),
          eq(attendance.employeeId, employeeId),
          gte(attendance.attendanceDate, startDate),
          lte(attendance.attendanceDate, endDate)
        )
      );

    const presentDays = attRows.filter(
      (r) => r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HALF_DAY'
    ).length;

    // Approved paid leaves in this period
    const leaveRows = await db.raw
      .select({ days: leaveApplications.days })
      .from(leaveApplications)
      .where(
        and(
          eq(leaveApplications.tenantId, tenantId),
          eq(leaveApplications.employeeId, employeeId),
          eq(leaveApplications.status, 'APPROVED'),
          gte(leaveApplications.startDate, startDate),
          lte(leaveApplications.endDate, endDate)
        )
      );

    const paidLeaveDays = leaveRows.reduce((sum, r) => sum + parseFloat(r.days), 0);

    const lopDays = Math.max(0, workingDays - presentDays - paidLeaveDays);
    const paidDaysRatio = Math.min(1, (presentDays + paidLeaveDays) / workingDays);

    // Pro-rate salary
    const basic = basicFull * paidDaysRatio;
    const hra = hraFull * paidDaysRatio;
    const da = daFull * paidDaysRatio;

    // Piece-rate for tailors
    const tailorRows = await db.raw
      .select({ amount: sql<string>`SUM(${tailorWorkLog.amount})` })
      .from(tailorWorkLog)
      .where(
        and(
          eq(tailorWorkLog.tenantId, tenantId),
          eq(tailorWorkLog.employeeId, employeeId),
          gte(tailorWorkLog.workDate, startDate),
          lte(tailorWorkLog.workDate, endDate)
        )
      );
    const pieceRateAmount = parseFloat(tailorRows[0]?.amount ?? '0') || 0;

    const otherAllowances = Math.max(0, grossFull - basicFull - hraFull - daFull) * paidDaysRatio;
    const grossSalary = basic + hra + da + otherAllowances + pieceRateAmount;

    const { pfEmployee, pfEmployer, epsAmount } = computePF(basic, pfApplicable);
    const { esiEmployee, esiEmployer } = computeESI(grossSalary, esiApplicable);

    // Professional Tax (monthly) — state-resolved: employee's branch state, falling back
    // to the tenant's registered state (PG-044).
    const employeeState = await resolveEmployeeState(
      db,
      tenantId,
      empRow?.branchId ?? null,
      ptStateCache
    );
    const ptSlabs = employeeState
      ? await PTSlabService.getSlabsForState(db, employeeState, startDate)
      : [];
    const professionalTax = PTSlabService.computePT(grossSalary, ptSlabs);

    // Loan EMI (PG-045): read-only sum of active loans, capped per-loan at remaining balance.
    // outstandingBalance is only decremented at payroll-run approval, not here.
    const activeLoans = await EmployeeLoanService.getActiveLoansForEmployee(
      db,
      tenantId,
      employeeId
    );
    const loanDeduction = computeLoanDeduction(activeLoans);
    // TDS (Section 192): projected on full (non-prorated) monthly gross × 12
    const tdsDeduction = computeMonthlyTDS(grossFull * 12);

    const totalDeductions =
      pfEmployee + esiEmployee + professionalTax + loanDeduction + tdsDeduction;
    const netSalary = Math.max(0, grossSalary - totalDeductions);

    return {
      employeeId,
      presentDays,
      paidLeaveDays,
      lopDays,
      workingDays,
      basicSalary: Math.round(basic * 100) / 100,
      hraAmount: Math.round(hra * 100) / 100,
      daAmount: Math.round(da * 100) / 100,
      otherAllowances: Math.round(otherAllowances * 100) / 100,
      pieceRateAmount: Math.round(pieceRateAmount * 100) / 100,
      grossSalary: Math.round(grossSalary * 100) / 100,
      pfEmployee,
      pfEmployer,
      epsAmount,
      esiEmployee,
      esiEmployer,
      professionalTax,
      loanDeduction,
      tdsDeduction,
      totalDeductions: Math.round(totalDeductions * 100) / 100,
      netSalary: Math.round(netSalary * 100) / 100,
    };
  }

  static async upsertSlip(
    db: TenantScopedDatabase,
    tenantId: number,
    payrollRunId: number,
    slip: PayrollSlipResult
  ): Promise<void> {
    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

    const existing = await db.raw
      .select({ id: payrollSlips.id })
      .from(payrollSlips)
      .where(
        and(
          eq(payrollSlips.tenantId, tenantId),
          eq(payrollSlips.payrollRunId, payrollRunId),
          eq(payrollSlips.employeeId, slip.employeeId)
        )
      );

    const values = {
      tenantId,
      payrollRunId,
      employeeId: slip.employeeId,
      presentDays: String(slip.presentDays),
      paidLeaveDays: String(slip.paidLeaveDays),
      lopDays: String(slip.lopDays),
      workingDays: slip.workingDays,
      basicSalary: String(slip.basicSalary),
      hraAmount: String(slip.hraAmount),
      daAmount: String(slip.daAmount),
      otherAllowances: String(slip.otherAllowances),
      pieceRateAmount: String(slip.pieceRateAmount),
      grossSalary: encryptField(String(slip.grossSalary), encKey),
      pfEmployee: String(slip.pfEmployee),
      epsAmount: String(slip.epsAmount),
      pfEmployer: String(slip.pfEmployer),
      esiEmployee: String(slip.esiEmployee),
      esiEmployer: String(slip.esiEmployer),
      professionalTax: String(slip.professionalTax),
      loanDeduction: String(slip.loanDeduction),
      tdsDeduction: String(slip.tdsDeduction),
      totalDeductions: String(slip.totalDeductions),
      netSalary: encryptField(String(slip.netSalary), encKey),
      status: 'DRAFT' as const,
      updatedAt: new Date(),
    };

    if (existing.length > 0 && existing[0]) {
      await db.raw
        .update(payrollSlips)
        .set(values as unknown as Partial<typeof payrollSlips.$inferInsert>)
        .where(eq(payrollSlips.id, existing[0].id));
    } else {
      await db.raw
        .insert(payrollSlips)
        .values({ ...values, createdAt: new Date() } as typeof payrollSlips.$inferInsert);
    }
  }
}
