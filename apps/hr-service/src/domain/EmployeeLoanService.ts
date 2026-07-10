import type { TenantScopedDatabase } from '@erp/sdk';
import { employeeLoans, loanDeductionHistory } from '@erp/db';
import { and, asc, eq } from 'drizzle-orm';
import { BusinessError, NotFoundError } from '@erp/types';

export interface EmployeeLoanRow {
  id: number;
  tenantId: number;
  employeeId: number;
  loanType: 'SALARY_ADVANCE' | 'FESTIVAL_ADVANCE' | 'GENERAL';
  principalAmount: number;
  tenureMonths: number;
  monthlyDeduction: number;
  disbursedAmount: number;
  disbursedDate: string;
  outstandingBalance: number;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  createdAt: Date;
  createdBy: number;
}

function toRow(r: typeof employeeLoans.$inferSelect): EmployeeLoanRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    employeeId: r.employeeId,
    loanType: r.loanType,
    principalAmount: parseFloat(r.principalAmount),
    tenureMonths: r.tenureMonths,
    monthlyDeduction: parseFloat(r.monthlyDeduction),
    disbursedAmount: parseFloat(r.disbursedAmount),
    disbursedDate: r.disbursedDate,
    outstandingBalance: parseFloat(r.outstandingBalance),
    status: r.status,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  };
}

export interface CreateLoanInput {
  employeeId: number;
  loanType: 'SALARY_ADVANCE' | 'FESTIVAL_ADVANCE' | 'GENERAL';
  principalAmount: number;
  tenureMonths: number;
  disbursedDate: string;
}

export class EmployeeLoanService {
  static computeMonthlyDeduction(principalAmount: number, tenureMonths: number): number {
    return Math.round((principalAmount / tenureMonths) * 100) / 100;
  }

  static async create(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    input: CreateLoanInput
  ): Promise<EmployeeLoanRow> {
    if (input.tenureMonths <= 0) {
      throw new BusinessError('INVALID_LOAN_TENURE', 'tenureMonths must be greater than zero');
    }

    const monthlyDeduction = EmployeeLoanService.computeMonthlyDeduction(input.principalAmount, input.tenureMonths);

    const [created] = await db.raw
      .insert(employeeLoans)
      .values({
        tenantId,
        employeeId: input.employeeId,
        loanType: input.loanType,
        principalAmount: String(input.principalAmount),
        tenureMonths: input.tenureMonths,
        monthlyDeduction: String(monthlyDeduction),
        disbursedAmount: String(input.principalAmount),
        disbursedDate: input.disbursedDate,
        outstandingBalance: String(input.principalAmount),
        status: 'ACTIVE',
        createdBy: userId,
      } as typeof employeeLoans.$inferInsert)
      .returning();

    if (!created) throw new Error('Employee loan insert failed');
    return toRow(created);
  }

  static async getActiveLoansForEmployee(
    db: TenantScopedDatabase,
    tenantId: number,
    employeeId: number
  ): Promise<EmployeeLoanRow[]> {
    const rows = await db.raw
      .select()
      .from(employeeLoans)
      .where(and(
        eq(employeeLoans.tenantId, tenantId),
        eq(employeeLoans.employeeId, employeeId),
        eq(employeeLoans.status, 'ACTIVE'),
      ))
      .orderBy(asc(employeeLoans.id));

    return rows.map(toRow);
  }

  static async list(
    db: TenantScopedDatabase,
    tenantId: number,
    employeeId: number
  ): Promise<EmployeeLoanRow[]> {
    const rows = await db.raw
      .select()
      .from(employeeLoans)
      .where(and(eq(employeeLoans.tenantId, tenantId), eq(employeeLoans.employeeId, employeeId)))
      .orderBy(asc(employeeLoans.id));

    return rows.map(toRow);
  }

  static async getById(
    db: TenantScopedDatabase,
    tenantId: number,
    id: number
  ): Promise<{ loan: EmployeeLoanRow; history: (typeof loanDeductionHistory.$inferSelect)[] }> {
    const [row] = await db.raw
      .select()
      .from(employeeLoans)
      .where(and(eq(employeeLoans.tenantId, tenantId), eq(employeeLoans.id, id)));

    if (!row) throw new NotFoundError('EmployeeLoan', id);

    const history = await db.raw
      .select()
      .from(loanDeductionHistory)
      .where(and(eq(loanDeductionHistory.tenantId, tenantId), eq(loanDeductionHistory.employeeLoanId, id)))
      .orderBy(asc(loanDeductionHistory.id));

    return { loan: toRow(row), history };
  }

  static async updateStatus(
    db: TenantScopedDatabase,
    tenantId: number,
    id: number,
    status: 'CANCELLED' | 'CLOSED'
  ): Promise<EmployeeLoanRow> {
    const [row] = await db.raw
      .select()
      .from(employeeLoans)
      .where(and(eq(employeeLoans.tenantId, tenantId), eq(employeeLoans.id, id)));

    if (!row) throw new NotFoundError('EmployeeLoan', id);

    if (status === 'CANCELLED' && parseFloat(row.outstandingBalance) !== parseFloat(row.principalAmount)) {
      throw new BusinessError('LOAN_ALREADY_DEDUCTED', 'Cannot cancel a loan once a deduction has been applied');
    }

    const [updated] = await db.raw
      .update(employeeLoans)
      .set({ status, updatedAt: new Date() })
      .where(eq(employeeLoans.id, id))
      .returning();

    if (!updated) throw new Error('Employee loan update failed');
    return toRow(updated);
  }

  // Applies this payroll run's EMI to each of the employee's active loans, capped per-loan
  // at its remaining outstandingBalance so the final EMI never overshoots. Must only be
  // called once per payroll-run approval (not on every DRAFT recalculation) — see
  // PayrollEngine.computeSlip, which sums the same capped amounts read-only for display.
  static async applyMonthlyDeduction(
    db: TenantScopedDatabase,
    tenantId: number,
    employeeId: number,
    payrollSlipId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<number> {
    const loans = await EmployeeLoanService.getActiveLoansForEmployee(db, tenantId, employeeId);
    let totalDeducted = 0;

    for (const loan of loans) {
      const deduction = Math.min(loan.monthlyDeduction, loan.outstandingBalance);
      if (deduction <= 0) continue;

      const newBalance = Math.round((loan.outstandingBalance - deduction) * 100) / 100;

      await db.raw
        .update(employeeLoans)
        .set({
          outstandingBalance: String(newBalance),
          status: newBalance <= 0 ? 'CLOSED' : 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(employeeLoans.id, loan.id));

      await db.raw.insert(loanDeductionHistory).values({
        tenantId,
        employeeLoanId: loan.id,
        payrollSlipId,
        amountDeducted: String(deduction),
        periodMonth,
        periodYear,
      } as typeof loanDeductionHistory.$inferInsert);

      totalDeducted = Math.round((totalDeducted + deduction) * 100) / 100;
    }

    return totalDeducted;
  }
}
