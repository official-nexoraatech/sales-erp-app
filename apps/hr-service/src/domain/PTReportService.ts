import type { TenantScopedDatabase } from '@erp/sdk';
import { payrollRuns, payrollSlips, employees } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '@erp/types';
import { decryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';

export interface PTReportRow {
  employeeId: number;
  employeeName: string;
  grossSalary: number;
  professionalTax: number;
}

export interface PTReportResult {
  periodMonth: number;
  periodYear: number;
  rows: PTReportRow[];
  totals: { professionalTax: number };
}

export class PTReportService {
  static async generateReport(
    db: TenantScopedDatabase,
    tenantId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<PTReportResult> {
    const [run] = await db.raw
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.tenantId, tenantId),
          eq(payrollRuns.periodMonth, periodMonth),
          eq(payrollRuns.periodYear, periodYear)
        )
      );

    if (!run) throw new NotFoundError('PayrollRun', `${periodMonth}/${periodYear}`);

    const slips = await db.raw
      .select({
        employeeId: payrollSlips.employeeId,
        displayName: employees.displayName,
        grossSalary: payrollSlips.grossSalary,
        professionalTax: payrollSlips.professionalTax,
      })
      .from(payrollSlips)
      .innerJoin(
        employees,
        and(eq(employees.id, payrollSlips.employeeId), eq(employees.tenantId, tenantId))
      )
      .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.payrollRunId, run.id)));

    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');
    const rows: PTReportRow[] = [];
    let totalPT = 0;

    for (const slip of slips) {
      const professionalTax = parseFloat(decryptField(slip.professionalTax, encKey));
      if (professionalTax <= 0) continue; // no PT this period (below-threshold state, or PT-free state)

      const grossSalary = parseFloat(decryptField(slip.grossSalary, encKey));
      rows.push({
        employeeId: slip.employeeId,
        employeeName: slip.displayName,
        grossSalary,
        professionalTax,
      });
      totalPT += professionalTax;
    }

    return {
      periodMonth,
      periodYear,
      rows,
      totals: { professionalTax: Math.round(totalPT * 100) / 100 },
    };
  }
}
