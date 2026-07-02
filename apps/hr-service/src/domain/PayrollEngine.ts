import { decryptField, encryptField } from '@erp/utils';
import { requireEnv } from '@erp/config';
import type { TenantScopedDatabase } from '@erp/sdk';
import {
  employeeSalaries,
  attendance,
  leaveApplications,
  tailorWorkLog,
  payrollSlips,
} from '@erp/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { BusinessError } from '@erp/types';

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
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  loanDeduction: number;
  tdsDeduction: number;
  totalDeductions: number;
  netSalary: number;
}

// Professional Tax slabs (Maharashtra as default)
const PT_SLABS = [
  { upTo: 10000, amount: 0 },
  { upTo: 15000, amount: 150 },
  { upTo: Infinity, amount: 200 },
];

function computePT(grossMonthly: number): number {
  for (const slab of PT_SLABS) {
    if (grossMonthly <= slab.upTo) return slab.amount;
  }
  return 200;
}

export class PayrollEngine {
  static async computeSlip(
    db: TenantScopedDatabase,
    tenantId: number,
    employeeId: number,
    periodMonth: number,
    periodYear: number,
    workingDays: number
  ): Promise<PayrollSlipResult> {
    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

    // Get active salary
    const [salRow] = await db.raw
      .select()
      .from(employeeSalaries)
      .where(and(
        eq(employeeSalaries.tenantId, tenantId),
        eq(employeeSalaries.employeeId, employeeId),
        eq(employeeSalaries.isActive, true),
      ));

    if (!salRow) {
      throw new BusinessError(
        'PAYROLL_NO_SALARY_STRUCTURE',
        `Employee ${employeeId} has no active salary assigned`
      );
    }

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
      .where(and(
        eq(attendance.tenantId, tenantId),
        eq(attendance.employeeId, employeeId),
        gte(attendance.attendanceDate, startDate),
        lte(attendance.attendanceDate, endDate),
      ));

    const presentDays = attRows.filter((r) =>
      r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HALF_DAY'
    ).length;

    // Approved paid leaves in this period
    const leaveRows = await db.raw
      .select({ days: leaveApplications.days })
      .from(leaveApplications)
      .where(and(
        eq(leaveApplications.tenantId, tenantId),
        eq(leaveApplications.employeeId, employeeId),
        eq(leaveApplications.status, 'APPROVED'),
        gte(leaveApplications.startDate, startDate),
        lte(leaveApplications.endDate, endDate),
      ));

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
      .where(and(
        eq(tailorWorkLog.tenantId, tenantId),
        eq(tailorWorkLog.employeeId, employeeId),
        gte(tailorWorkLog.workDate, startDate),
        lte(tailorWorkLog.workDate, endDate),
      ));
    const pieceRateAmount = parseFloat(tailorRows[0]?.amount ?? '0') || 0;

    const otherAllowances = Math.max(0, (grossFull - basicFull - hraFull - daFull)) * paidDaysRatio;
    const grossSalary = basic + hra + da + otherAllowances + pieceRateAmount;

    // PF: 12% of basic (capped at 15000 basic for EPF)
    const pfBasic = Math.min(basic, 15000);
    const pfEmployee = Math.round(pfBasic * 0.12 * 100) / 100;
    const pfEmployer = Math.round(pfBasic * 0.12 * 100) / 100;

    // ESI: if gross <= 21000
    let esiEmployee = 0;
    let esiEmployer = 0;
    if (grossSalary <= 21000) {
      esiEmployee = Math.round(grossSalary * 0.0075 * 100) / 100;
      esiEmployer = Math.round(grossSalary * 0.0325 * 100) / 100;
    }

    // Professional Tax (monthly)
    const professionalTax = computePT(grossSalary);

    const loanDeduction = 0; // future: from loan_deductions table
    const tdsDeduction = 0;  // future: from tds computation

    const totalDeductions = pfEmployee + esiEmployee + professionalTax + loanDeduction + tdsDeduction;
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
      .where(and(
        eq(payrollSlips.tenantId, tenantId),
        eq(payrollSlips.payrollRunId, payrollRunId),
        eq(payrollSlips.employeeId, slip.employeeId),
      ));

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
