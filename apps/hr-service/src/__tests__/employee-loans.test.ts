import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  employeeLoans: {
    id: {}, tenantId: {}, employeeId: {}, loanType: {}, principalAmount: {}, tenureMonths: {},
    monthlyDeduction: {}, disbursedAmount: {}, disbursedDate: {}, outstandingBalance: {}, status: {},
    createdAt: {}, createdBy: {}, updatedAt: {},
  },
  loanDeductionHistory: {
    id: {}, tenantId: {}, employeeLoanId: {}, payrollSlipId: {}, amountDeducted: {}, periodMonth: {}, periodYear: {}, createdAt: {},
  },
}));

// Generic chainable query mock — resolve queued results in call order (same shape as
// statutory-payroll.test.ts's makeDb). Each .where() call consumes one queue entry and is
// awaitable directly (select().from().where()) or via a trailing .orderBy() (both terminate
// the same query, so only .where() advances the queue). insert()/update() calls are recorded.
function makeDb(selectQueue: unknown[][]) {
  let i = 0;
  const inserted: Record<string, unknown>[] = [];
  const updated: { table: unknown; values: Record<string, unknown> }[] = [];

  const selectChain = {
    from: () => selectChain,
    where: () => {
      const result = selectQueue[i++] ?? [];
      return Object.assign(Promise.resolve(result), {
        orderBy: () => Promise.resolve(result),
      });
    },
  };

  const db = {
    raw: {
      select: () => selectChain,
      insert: (_table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          inserted.push(vals);
          return { returning: () => Promise.resolve([{ id: 1, ...vals }]) };
        },
      }),
      update: (_table: unknown) => ({
        set: (vals: Record<string, unknown>) => {
          updated.push({ table: _table, values: vals });
          return { where: () => ({ returning: () => Promise.resolve([{ id: 1, ...vals }]) }) };
        },
      }),
    },
  };

  return { db: db as never, inserted, updated };
}

describe('computeLoanDeduction (PayrollEngine)', () => {
  it('returns 0 when the employee has no active loans (regression-safe)', async () => {
    const { computeLoanDeduction } = await import('../domain/PayrollEngine.js');
    expect(computeLoanDeduction([])).toBe(0);
  });

  it('sums monthlyDeduction across multiple active loans', async () => {
    const { computeLoanDeduction } = await import('../domain/PayrollEngine.js');
    const total = computeLoanDeduction([
      { monthlyDeduction: 1000, outstandingBalance: 5000 },
      { monthlyDeduction: 500, outstandingBalance: 2000 },
    ]);
    expect(total).toBe(1500);
  });

  it('caps a loan\'s contribution at its remaining outstandingBalance so the final EMI does not overshoot', async () => {
    const { computeLoanDeduction } = await import('../domain/PayrollEngine.js');
    const total = computeLoanDeduction([{ monthlyDeduction: 1000, outstandingBalance: 400 }]);
    expect(total).toBe(400);
  });
});

describe('EmployeeLoanService.computeMonthlyDeduction', () => {
  it('computes a flat EMI as principal / tenure, rounded to 2 decimals', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    expect(EmployeeLoanService.computeMonthlyDeduction(10000, 3)).toBe(3333.33);
  });
});

describe('EmployeeLoanService.create', () => {
  it('rejects tenureMonths <= 0 with INVALID_LOAN_TENURE', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db } = makeDb([]);
    await expect(
      EmployeeLoanService.create(db, 1, 7, {
        employeeId: 10,
        loanType: 'GENERAL',
        principalAmount: 12000,
        tenureMonths: 0,
        disbursedDate: '2026-07-01',
      })
    ).rejects.toMatchObject({ code: 'INVALID_LOAN_TENURE' });
  });

  it('sets outstandingBalance = principalAmount and status ACTIVE on creation', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db, inserted } = makeDb([]);
    const loan = await EmployeeLoanService.create(db, 1, 7, {
      employeeId: 10,
      loanType: 'SALARY_ADVANCE',
      principalAmount: 12000,
      tenureMonths: 12,
      disbursedDate: '2026-07-01',
    });
    expect(loan.outstandingBalance).toBe(12000);
    expect(loan.status).toBe('ACTIVE');
    expect(loan.monthlyDeduction).toBe(1000);
    expect(inserted[0]?.['outstandingBalance']).toBe('12000');
  });
});

describe('EmployeeLoanService.applyMonthlyDeduction', () => {
  it('decrements outstandingBalance by monthlyDeduction and records history for a single active loan', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db, updated, inserted } = makeDb([
      [{ id: 1, tenantId: 1, employeeId: 10, loanType: 'GENERAL', principalAmount: '12000', tenureMonths: 12, monthlyDeduction: '1000', disbursedAmount: '12000', disbursedDate: '2026-07-01', outstandingBalance: '5000', status: 'ACTIVE', createdAt: new Date(), createdBy: 7, updatedAt: new Date() }],
    ]);

    const total = await EmployeeLoanService.applyMonthlyDeduction(db, 1, 10, 99, 7, 2026);

    expect(total).toBe(1000);
    expect(updated[0]?.values['outstandingBalance']).toBe('4000');
    expect(updated[0]?.values['status']).toBe('ACTIVE');
    expect(inserted[0]).toMatchObject({ employeeLoanId: 1, payrollSlipId: 99, amountDeducted: '1000', periodMonth: 7, periodYear: 2026 });
  });

  it('caps the final EMI at the remaining balance and auto-closes the loan at zero', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db, updated } = makeDb([
      [{ id: 1, tenantId: 1, employeeId: 10, loanType: 'GENERAL', principalAmount: '12000', tenureMonths: 12, monthlyDeduction: '1000', disbursedAmount: '12000', disbursedDate: '2026-07-01', outstandingBalance: '400', status: 'ACTIVE', createdAt: new Date(), createdBy: 7, updatedAt: new Date() }],
    ]);

    const total = await EmployeeLoanService.applyMonthlyDeduction(db, 1, 10, 99, 7, 2026);

    expect(total).toBe(400);
    expect(updated[0]?.values['outstandingBalance']).toBe('0');
    expect(updated[0]?.values['status']).toBe('CLOSED');
  });

  it('sums deductions across multiple active loans for the same employee', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db, updated } = makeDb([
      [
        { id: 1, tenantId: 1, employeeId: 10, loanType: 'GENERAL', principalAmount: '12000', tenureMonths: 12, monthlyDeduction: '1000', disbursedAmount: '12000', disbursedDate: '2026-07-01', outstandingBalance: '5000', status: 'ACTIVE', createdAt: new Date(), createdBy: 7, updatedAt: new Date() },
        { id: 2, tenantId: 1, employeeId: 10, loanType: 'FESTIVAL_ADVANCE', principalAmount: '3000', tenureMonths: 6, monthlyDeduction: '500', disbursedAmount: '3000', disbursedDate: '2026-07-01', outstandingBalance: '1500', status: 'ACTIVE', createdAt: new Date(), createdBy: 7, updatedAt: new Date() },
      ],
    ]);

    const total = await EmployeeLoanService.applyMonthlyDeduction(db, 1, 10, 99, 7, 2026);

    expect(total).toBe(1500);
    expect(updated).toHaveLength(2);
  });
});

describe('EmployeeLoanService.updateStatus', () => {
  it('allows CANCELLED before any deduction has been applied', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db } = makeDb([
      [{ id: 1, tenantId: 1, employeeId: 10, loanType: 'GENERAL', principalAmount: '12000', tenureMonths: 12, monthlyDeduction: '1000', disbursedAmount: '12000', disbursedDate: '2026-07-01', outstandingBalance: '12000', status: 'ACTIVE', createdAt: new Date(), createdBy: 7, updatedAt: new Date() }],
    ]);

    const loan = await EmployeeLoanService.updateStatus(db, 1, 1, 'CANCELLED');
    expect(loan.status).toBe('CANCELLED');
  });

  it('rejects CANCELLED once a deduction has been applied (outstandingBalance < principalAmount)', async () => {
    const { EmployeeLoanService } = await import('../domain/EmployeeLoanService.js');
    const { db } = makeDb([
      [{ id: 1, tenantId: 1, employeeId: 10, loanType: 'GENERAL', principalAmount: '12000', tenureMonths: 12, monthlyDeduction: '1000', disbursedAmount: '12000', disbursedDate: '2026-07-01', outstandingBalance: '11000', status: 'ACTIVE', createdAt: new Date(), createdBy: 7, updatedAt: new Date() }],
    ]);

    await expect(EmployeeLoanService.updateStatus(db, 1, 1, 'CANCELLED')).rejects.toMatchObject({ code: 'LOAN_ALREADY_DEDUCTED' });
  });
});
