import type { TenantScopedDatabase } from '@erp/sdk';
import { payrollRuns, payrollSlips, employees } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '@erp/types';

export interface PFChallanRow {
  employeeId: number;
  uan: string | null;
  employeeName: string;
  basicSalary: number;
  epfEmployee: number;
  epfEmployer: number;
  epsAmount: number;
}

export interface PFChallanResult {
  periodMonth: number;
  periodYear: number;
  rows: PFChallanRow[];
  totals: {
    basicSalary: number;
    epfEmployee: number;
    epfEmployer: number;
    epsAmount: number;
  };
}

export class PFChallanService {
  static async generateChallan(
    db: TenantScopedDatabase,
    tenantId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<PFChallanResult> {
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
        uan: employees.uan,
        basicSalary: payrollSlips.basicSalary,
        pfEmployee: payrollSlips.pfEmployee,
        pfEmployer: payrollSlips.pfEmployer,
        epsAmount: payrollSlips.epsAmount,
      })
      .from(payrollSlips)
      .innerJoin(employees, and(eq(employees.id, payrollSlips.employeeId), eq(employees.tenantId, tenantId)))
      .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.payrollRunId, run.id)));

    const rows: PFChallanRow[] = [];
    const totals = { basicSalary: 0, epfEmployee: 0, epfEmployer: 0, epsAmount: 0 };

    for (const slip of slips) {
      const epfEmployee = parseFloat(String(slip.pfEmployee));
      if (epfEmployee <= 0) continue; // not PF-applicable this period

      const basicSalary = parseFloat(String(slip.basicSalary));
      const epfEmployer = parseFloat(String(slip.pfEmployer));
      const epsAmount = parseFloat(String(slip.epsAmount));

      rows.push({
        employeeId: slip.employeeId,
        uan: slip.uan,
        employeeName: slip.displayName,
        basicSalary,
        epfEmployee,
        epfEmployer,
        epsAmount,
      });

      totals.basicSalary += basicSalary;
      totals.epfEmployee += epfEmployee;
      totals.epfEmployer += epfEmployer;
      totals.epsAmount += epsAmount;
    }

    return {
      periodMonth,
      periodYear,
      rows,
      totals: {
        basicSalary: Math.round(totals.basicSalary * 100) / 100,
        epfEmployee: Math.round(totals.epfEmployee * 100) / 100,
        epfEmployer: Math.round(totals.epfEmployer * 100) / 100,
        epsAmount: Math.round(totals.epsAmount * 100) / 100,
      },
    };
  }
}
