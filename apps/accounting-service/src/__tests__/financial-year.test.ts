import { describe, it, expect, vi, beforeEach } from 'vitest';
import { periodClosures } from '@erp/db';

// ─── closeYear mocks ─────────────────────────────────────────────────────────
// JournalEngine/ReportsEngine are mocked so closeYear()'s closing-entry
// construction can be tested without a live Postgres trigger/checklist queries.

vi.mock('../domain/JournalEngine.js', () => ({
  JournalEngine: {
    post: vi.fn().mockResolvedValue({ journalId: 'JRN-CLOSE-001', linesPosted: 2 }),
  },
}));

vi.mock('../domain/ReportsEngine.js', () => ({
  ReportsEngine: {
    getTrialBalance: vi.fn().mockResolvedValue({ isBalanced: true, totalDebits: 0, totalCredits: 0 }),
    getProfitLoss: vi.fn(),
  },
}));

import { JournalEngine } from '../domain/JournalEngine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface InsertedRow {
  tenantId: number;
  financialYearId: number;
  periodMonth: number;
  periodYear: number;
  startDate: string;
  endDate: string;
  status: string;
}

function makeMockDb(capturedRows: InsertedRow[], mockFy: unknown): object {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  return {
    raw: {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      insert: vi.fn().mockImplementation((table: unknown) => {
        if (table === periodClosures) {
          return {
            values: vi.fn().mockImplementation((rows: InsertedRow[]) => {
              capturedRows.push(...rows);
              return { onConflictDoNothing };
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockFy]) }),
        };
      }),
    },
  };
}

const BASE_FY = {
  tenantId: 1,
  yearCode: 'FY2026-27',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  status: 'OPEN',
  isCurrent: false,
  createdBy: 1,
  createdAt: new Date(),
  closedAt: null,
  closedBy: null,
  closingEntriesJournalId: null,
  notes: null,
};

describe('FinancialYearService period seeding', () => {
  it('seeds exactly 12 period_closures rows for April 2026 – March 2027', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const rows: InsertedRow[] = [];
    const mockDb = makeMockDb(rows, { ...BASE_FY, id: 42, isCurrent: true });

    await FinancialYearService.create(
      mockDb as never,
      1,
      1,
      { yearCode: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31', isCurrent: true }
    );

    expect(rows).toHaveLength(12);
  });

  it('generates correct start_date and end_date for each month (April 2026 – March 2027)', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const rows: InsertedRow[] = [];
    const mockDb = makeMockDb(rows, { ...BASE_FY, id: 43 });

    await FinancialYearService.create(
      mockDb as never,
      1,
      1,
      { yearCode: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }
    );

    const expected: Array<{ month: number; year: number; start: string; end: string }> = [
      { month: 4,  year: 2026, start: '2026-04-01', end: '2026-04-30' },
      { month: 5,  year: 2026, start: '2026-05-01', end: '2026-05-31' },
      { month: 6,  year: 2026, start: '2026-06-01', end: '2026-06-30' },
      { month: 7,  year: 2026, start: '2026-07-01', end: '2026-07-31' },
      { month: 8,  year: 2026, start: '2026-08-01', end: '2026-08-31' },
      { month: 9,  year: 2026, start: '2026-09-01', end: '2026-09-30' },
      { month: 10, year: 2026, start: '2026-10-01', end: '2026-10-31' },
      { month: 11, year: 2026, start: '2026-11-01', end: '2026-11-30' },
      { month: 12, year: 2026, start: '2026-12-01', end: '2026-12-31' },
      { month: 1,  year: 2027, start: '2027-01-01', end: '2027-01-31' },
      { month: 2,  year: 2027, start: '2027-02-01', end: '2027-02-28' },
      { month: 3,  year: 2027, start: '2027-03-01', end: '2027-03-31' },
    ];

    expect(rows).toHaveLength(12);
    rows.forEach((row, i) => {
      const exp = expected[i];
      expect(row.periodMonth).toBe(exp?.month);
      expect(row.periodYear).toBe(exp?.year);
      expect(row.startDate).toBe(exp?.start);
      expect(row.endDate).toBe(exp?.end);
    });
  });

  it('all 12 seeded rows have status OPEN', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const rows: InsertedRow[] = [];
    const mockDb = makeMockDb(rows, { ...BASE_FY, id: 44 });

    await FinancialYearService.create(
      mockDb as never,
      1,
      1,
      { yearCode: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }
    );

    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.status).toBe('OPEN');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// closeYear — PG-033 Income Summary routing
// ═══════════════════════════════════════════════════════════════════════════

interface AccountRow { id: number; account_code?: string }

function makePL(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    from: '2026-04-01',
    to: '2027-03-31',
    revenue: [],
    totalRevenue: 0,
    cogs: [],
    totalCogs: 0,
    contraRevenue: [],
    totalContraRevenue: 0,
    grossProfit: 0,
    operatingExpenses: [],
    totalOperatingExpenses: 0,
    operatingProfit: 0,
    otherIncome: [],
    totalOtherIncome: 0,
    financialCharges: [],
    totalFinancialCharges: 0,
    netProfit: 0,
    generatedAt: new Date().toISOString(),
    ...partial,
  };
}

function makeCloseYearMockDb(opts: {
  fy: Record<string, unknown>;
  incomeSummaryAccount: AccountRow | null;
  retainedEarningsAccount: AccountRow | null;
}) {
  // 8 checklist count-queries (all pass), then the two account lookups made
  // directly inside closeYear()'s transaction, in the exact order they're called.
  const executeQueue: unknown[][] = [
    [{ cnt: 0 }], [{ cnt: 0 }], [{ cnt: 0 }], [{ cnt: 0 }],
    [{ cnt: 0 }], [{ cnt: 0 }], [{ cnt: 0 }], [{ cnt: 0 }],
    opts.incomeSummaryAccount ? [opts.incomeSummaryAccount] : [],
    opts.retainedEarningsAccount ? [opts.retainedEarningsAccount] : [],
  ];

  let updateSet: Record<string, unknown> | undefined;

  const raw = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([opts.fy])),
      })),
    })),
    execute: vi.fn(() => Promise.resolve(executeQueue.shift())),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updateSet = vals;
        return { where: vi.fn(() => Promise.resolve([])) };
      }),
    })),
  };

  const db = { raw, transaction: vi.fn(async (cb: (trx: { raw: typeof raw }) => unknown) => cb({ raw })) };
  return { db, getUpdateSet: () => updateSet };
}

interface JournalLineCall { accountId: number; debitAmount: number; creditAmount: number }

function sumBy(lines: JournalLineCall[], accountId: number, field: 'debitAmount' | 'creditAmount'): number {
  return lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + l[field], 0);
}

describe('FinancialYearService.closeYear', () => {
  beforeEach(() => {
    vi.mocked(JournalEngine.post).mockClear();
    vi.mocked(JournalEngine.post).mockResolvedValue({ journalId: 'JRN-CLOSE-001', linesPosted: 2 });
  });

  const FY_TO_CLOSE = { ...BASE_FY, id: 50, status: 'OPEN' };
  const INCOME_SUMMARY = { id: 900 };
  const RETAINED_EARNINGS = { id: 302, account_code: '3020' };

  it('net-profit year: closes revenue/expense accounts through Income Summary and credits the net profit to Retained Earnings', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const { ReportsEngine } = await import('../domain/ReportsEngine.js');

    vi.mocked(ReportsEngine.getProfitLoss).mockResolvedValue(makePL({
      revenue: [{ accountId: 10, accountCode: '4000', accountName: 'Sales Revenue', amount: 1000 }],
      totalRevenue: 1000,
      operatingExpenses: [{ accountId: 60, accountCode: '6000', accountName: 'Operating Expenses', amount: 600 }],
      totalOperatingExpenses: 600,
      netProfit: 400,
    }) as never);

    const { db, getUpdateSet } = makeCloseYearMockDb({
      fy: FY_TO_CLOSE,
      incomeSummaryAccount: INCOME_SUMMARY,
      retainedEarningsAccount: RETAINED_EARNINGS,
    });

    await FinancialYearService.closeYear(db as never, 1, 1, 50);

    const lines = vi.mocked(JournalEngine.post).mock.calls[0]?.[3]?.lines as unknown as JournalLineCall[];

    // Revenue account closed by debiting it for its full period balance.
    expect(sumBy(lines, 10, 'debitAmount')).toBe(1000);
    expect(sumBy(lines, 10, 'creditAmount')).toBe(0);

    // Expense account closed by crediting it for its full period balance.
    expect(sumBy(lines, 60, 'creditAmount')).toBe(600);
    expect(sumBy(lines, 60, 'debitAmount')).toBe(0);

    // Income Summary passes the balance through and ends back at zero.
    expect(sumBy(lines, 900, 'debitAmount')).toBe(sumBy(lines, 900, 'creditAmount'));
    expect(sumBy(lines, 900, 'debitAmount')).toBe(1000);

    // Net profit (400) lands as a credit to Retained Earnings.
    expect(sumBy(lines, 302, 'creditAmount')).toBe(400);
    expect(sumBy(lines, 302, 'debitAmount')).toBe(0);

    // Whole journal balances by construction.
    const totalDr = lines.reduce((s, l) => s + l.debitAmount, 0);
    const totalCr = lines.reduce((s, l) => s + l.creditAmount, 0);
    expect(totalDr).toBeCloseTo(totalCr, 2);

    expect(getUpdateSet()).toMatchObject({ status: 'CLOSED', closingEntriesJournalId: 'JRN-CLOSE-001' });
  });

  it('net-loss year: debits the net loss to Retained Earnings instead of crediting it', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const { ReportsEngine } = await import('../domain/ReportsEngine.js');

    vi.mocked(ReportsEngine.getProfitLoss).mockResolvedValue(makePL({
      revenue: [{ accountId: 10, accountCode: '4000', accountName: 'Sales Revenue', amount: 500 }],
      totalRevenue: 500,
      operatingExpenses: [{ accountId: 60, accountCode: '6000', accountName: 'Operating Expenses', amount: 900 }],
      totalOperatingExpenses: 900,
      netProfit: -400,
    }) as never);

    const { db } = makeCloseYearMockDb({
      fy: FY_TO_CLOSE,
      incomeSummaryAccount: INCOME_SUMMARY,
      retainedEarningsAccount: RETAINED_EARNINGS,
    });

    await FinancialYearService.closeYear(db as never, 1, 1, 50);

    const lines = vi.mocked(JournalEngine.post).mock.calls[0]?.[3]?.lines as unknown as JournalLineCall[];

    // Net loss (400) lands as a debit to Retained Earnings.
    expect(sumBy(lines, 302, 'debitAmount')).toBe(400);
    expect(sumBy(lines, 302, 'creditAmount')).toBe(0);

    // Income Summary still passes through to zero.
    expect(sumBy(lines, 900, 'debitAmount')).toBe(sumBy(lines, 900, 'creditAmount'));

    const totalDr = lines.reduce((s, l) => s + l.debitAmount, 0);
    const totalCr = lines.reduce((s, l) => s + l.creditAmount, 0);
    expect(totalDr).toBeCloseTo(totalCr, 2);
  });

  it('throws INCOME_SUMMARY_ACCOUNT_MISSING and posts nothing when the tenant has no Income Summary account', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const { ReportsEngine } = await import('../domain/ReportsEngine.js');

    vi.mocked(ReportsEngine.getProfitLoss).mockResolvedValue(makePL({
      revenue: [{ accountId: 10, accountCode: '4000', accountName: 'Sales Revenue', amount: 1000 }],
      totalRevenue: 1000,
      netProfit: 1000,
    }) as never);

    const { db, getUpdateSet } = makeCloseYearMockDb({
      fy: FY_TO_CLOSE,
      incomeSummaryAccount: null,
      retainedEarningsAccount: RETAINED_EARNINGS,
    });

    await expect(FinancialYearService.closeYear(db as never, 1, 1, 50)).rejects.toMatchObject({
      code: 'INCOME_SUMMARY_ACCOUNT_MISSING',
    });

    expect(JournalEngine.post).not.toHaveBeenCalled();
    expect(getUpdateSet()).toBeUndefined();
  });
});
