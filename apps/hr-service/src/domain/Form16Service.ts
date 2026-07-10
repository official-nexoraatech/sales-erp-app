import { decryptField } from '@erp/utils';
import { requireEnv } from '@erp/config';
import type { TenantScopedDatabase } from '@erp/sdk';
import { payrollRuns, payrollSlips, employees, organizationSettings } from '@erp/db';
import { and, eq, or, gte, lte } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '@erp/types';

export interface Form16MonthlyBreakdown {
  periodMonth: number;
  periodYear: number;
  gross: number;
  tds: number;
  pf: number;
  esi: number;
}

export interface Form16Data {
  employeeName: string;
  pan: string | null;
  employerName: string;
  employerTAN: string | null;
  grossSalary: number;
  standardDeduction: number;
  taxableIncome: number;
  totalTDSDeducted: number;
  monthlyBreakdown: Form16MonthlyBreakdown[];
}

const STANDARD_DEDUCTION = 75000;

function parseFinancialYear(financialYear: string): { startYear: number; endYear: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!match?.[1] || !match[2]) {
    throw new ValidationError(`Invalid financial year format: ${financialYear}. Expected YYYY-YY, e.g. 2025-26`);
  }
  const startYear = parseInt(match[1], 10);
  const endYear = startYear + 1;
  return { startYear, endYear };
}

export class Form16Service {
  static async generateForm16Data(
    db: TenantScopedDatabase,
    tenantId: number,
    employeeId: number,
    financialYear: string
  ): Promise<Form16Data> {
    const { startYear, endYear } = parseFinancialYear(financialYear);
    const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

    const [emp] = await db.raw
      .select({ displayName: employees.displayName, panEncrypted: employees.panEncrypted })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
    if (!emp) throw new NotFoundError('Employee', employeeId);

    const [org] = await db.raw
      .select({ orgName: organizationSettings.orgName, legalName: organizationSettings.legalName, tan: organizationSettings.tan })
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));

    const slips = await db.raw
      .select({
        periodMonth: payrollRuns.periodMonth,
        periodYear: payrollRuns.periodYear,
        grossSalary: payrollSlips.grossSalary,
        tdsDeduction: payrollSlips.tdsDeduction,
        pfEmployee: payrollSlips.pfEmployee,
        esiEmployee: payrollSlips.esiEmployee,
      })
      .from(payrollSlips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollSlips.payrollRunId))
      .where(and(
        eq(payrollSlips.tenantId, tenantId),
        eq(payrollSlips.employeeId, employeeId),
        or(
          and(eq(payrollRuns.periodYear, startYear), gte(payrollRuns.periodMonth, 4)),
          and(eq(payrollRuns.periodYear, endYear), lte(payrollRuns.periodMonth, 3)),
        ),
      ));

    let grossSalary = 0;
    let totalTDSDeducted = 0;
    const monthlyBreakdown: Form16MonthlyBreakdown[] = [];

    for (const slip of slips) {
      const gross = parseFloat(decryptField(slip.grossSalary, encKey));
      const tds = parseFloat(String(slip.tdsDeduction));
      grossSalary += gross;
      totalTDSDeducted += tds;
      monthlyBreakdown.push({
        periodMonth: slip.periodMonth,
        periodYear: slip.periodYear,
        gross: Math.round(gross * 100) / 100,
        tds: Math.round(tds * 100) / 100,
        pf: parseFloat(String(slip.pfEmployee)),
        esi: parseFloat(String(slip.esiEmployee)),
      });
    }

    monthlyBreakdown.sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth));

    const taxableIncome = Math.max(0, grossSalary - STANDARD_DEDUCTION);

    return {
      employeeName: emp.displayName,
      pan: emp.panEncrypted ? decryptField(emp.panEncrypted, encKey) : null,
      employerName: org?.legalName ?? org?.orgName ?? 'N/A',
      employerTAN: org?.tan ?? null,
      grossSalary: Math.round(grossSalary * 100) / 100,
      standardDeduction: STANDARD_DEDUCTION,
      taxableIncome: Math.round(taxableIncome * 100) / 100,
      totalTDSDeducted: Math.round(totalTDSDeducted * 100) / 100,
      monthlyBreakdown,
    };
  }
}
