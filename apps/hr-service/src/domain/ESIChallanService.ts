import type { TenantScopedDatabase } from '@erp/sdk';
import { payrollRuns, payrollSlips, employees } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '@erp/types';

export interface ESIChallanRow {
  employeeId: number;
  esiNumber: string | null;
  employeeName: string;
  grossSalary: number;
  esiEmployee: number;
  esiEmployer: number;
}

export interface ESIChallanResult {
  periodMonth: number;
  periodYear: number;
  rows: ESIChallanRow[];
  totals: {
    grossSalary: number;
    esiEmployee: number;
    esiEmployer: number;
  };
}

export class ESIChallanService {
  static async generateChallan(
    db: TenantScopedDatabase,
    tenantId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<ESIChallanResult> {
    const [run] = await db.raw
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(and(
        eq(payrollRuns.tenantId, tenantId),
        eq(payrollRuns.periodMonth, periodMonth),
        eq(payrollRuns.periodYear, periodYear),
      ));

    if (!run) throw new NotFoundError('PayrollRun', `${periodMonth}/${periodYear}`);

    const slips = await db.raw
      .select({
        employeeId: payrollSlips.employeeId,
        displayName: employees.displayName,
        esiNumber: employees.esiNumber,
        basicSalary: payrollSlips.basicSalary,
        hraAmount: payrollSlips.hraAmount,
        daAmount: payrollSlips.daAmount,
        otherAllowances: payrollSlips.otherAllowances,
        pieceRateAmount: payrollSlips.pieceRateAmount,
        esiEmployee: payrollSlips.esiEmployee,
        esiEmployer: payrollSlips.esiEmployer,
      })
      .from(payrollSlips)
      .innerJoin(employees, and(eq(employees.id, payrollSlips.employeeId), eq(employees.tenantId, tenantId)))
      .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.payrollRunId, run.id)));

    const rows: ESIChallanRow[] = [];
    const totals = { grossSalary: 0, esiEmployee: 0, esiEmployer: 0 };

    for (const slip of slips) {
      const esiEmployee = parseFloat(String(slip.esiEmployee));
      if (esiEmployee <= 0) continue; // not ESI-applicable this period

      const grossSalary =
        parseFloat(String(slip.basicSalary)) +
        parseFloat(String(slip.hraAmount)) +
        parseFloat(String(slip.daAmount)) +
        parseFloat(String(slip.otherAllowances)) +
        parseFloat(String(slip.pieceRateAmount));
      const esiEmployer = parseFloat(String(slip.esiEmployer));

      rows.push({
        employeeId: slip.employeeId,
        esiNumber: slip.esiNumber,
        employeeName: slip.displayName,
        grossSalary: Math.round(grossSalary * 100) / 100,
        esiEmployee,
        esiEmployer,
      });

      totals.grossSalary += grossSalary;
      totals.esiEmployee += esiEmployee;
      totals.esiEmployer += esiEmployer;
    }

    return {
      periodMonth,
      periodYear,
      rows,
      totals: {
        grossSalary: Math.round(totals.grossSalary * 100) / 100,
        esiEmployee: Math.round(totals.esiEmployee * 100) / 100,
        esiEmployer: Math.round(totals.esiEmployer * 100) / 100,
      },
    };
  }
}
