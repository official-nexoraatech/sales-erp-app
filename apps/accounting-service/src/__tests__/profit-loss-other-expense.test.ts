import { describe, it, expect, vi } from 'vitest';
import { ReportsEngine } from '../domain/ReportsEngine.js';

// Regression test for the 2026-07-31 audit fix: getProfitLoss() previously dropped any
// EXPENSE-type account whose sub-type was OTHER_EXPENSE or unset (null) from every bucket,
// silently excluding it from netProfit — undercounting real expenses, and causing
// getBalanceSheet()'s derived "Current Year Earnings" line to disagree with report-service's
// independent balance-sheet-report query (which already summed ALL EXPENSE+CONTRA rows).

type PLRow = {
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  account_sub_type: string | null;
  total_debits: string;
  total_credits: string;
};

function makePLDb(rows: PLRow[]) {
  return { raw: { execute: vi.fn().mockResolvedValue(rows) } } as never;
}

describe('ReportsEngine.getProfitLoss — OTHER_EXPENSE / unclassified expense inclusion', () => {
  it('includes an OTHER_EXPENSE-subtype account in otherExpenses and subtracts it from netProfit', async () => {
    const db = makePLDb([
      {
        account_id: 1,
        account_code: '4000',
        account_name: 'Sales Revenue',
        account_type: 'INCOME',
        account_sub_type: 'SALES_REVENUE',
        total_debits: '0',
        total_credits: '10000',
      },
      {
        account_id: 2,
        account_code: '5900',
        account_name: 'Bank Charges (Other Expense)',
        account_type: 'EXPENSE',
        account_sub_type: 'OTHER_EXPENSE',
        total_debits: '500',
        total_credits: '0',
      },
    ]);

    const pl = await ReportsEngine.getProfitLoss(db, 1, '2026-04-01', '2026-04-30');

    expect(pl.otherExpenses).toHaveLength(1);
    expect(pl.totalOtherExpenses).toBe(500);
    // Before the fix: netProfit would have been 10000 (the 500 silently dropped).
    expect(pl.netProfit).toBe(9500);
  });

  it('includes an EXPENSE-type account with a null (unset) sub-type the same way', async () => {
    const db = makePLDb([
      {
        account_id: 1,
        account_code: '4000',
        account_name: 'Sales Revenue',
        account_type: 'INCOME',
        account_sub_type: 'SALES_REVENUE',
        total_debits: '0',
        total_credits: '5000',
      },
      {
        account_id: 3,
        account_code: '5950',
        account_name: 'Misc Expense (no sub-type set)',
        account_type: 'EXPENSE',
        account_sub_type: null,
        total_debits: '200',
        total_credits: '0',
      },
    ]);

    const pl = await ReportsEngine.getProfitLoss(db, 1, '2026-04-01', '2026-04-30');

    expect(pl.totalOtherExpenses).toBe(200);
    expect(pl.netProfit).toBe(4800);
  });

  it('does not double-count COST_OF_GOODS/OPERATING_EXPENSE/TAX_EXPENSE into otherExpenses', async () => {
    const db = makePLDb([
      {
        account_id: 1,
        account_code: '4000',
        account_name: 'Sales Revenue',
        account_type: 'INCOME',
        account_sub_type: 'SALES_REVENUE',
        total_debits: '0',
        total_credits: '10000',
      },
      {
        account_id: 2,
        account_code: '5000',
        account_name: 'COGS',
        account_type: 'EXPENSE',
        account_sub_type: 'COST_OF_GOODS',
        total_debits: '3000',
        total_credits: '0',
      },
      {
        account_id: 3,
        account_code: '5100',
        account_name: 'Operating Expense',
        account_type: 'EXPENSE',
        account_sub_type: 'OPERATING_EXPENSE',
        total_debits: '1000',
        total_credits: '0',
      },
      {
        account_id: 4,
        account_code: '5200',
        account_name: 'Tax Expense',
        account_type: 'EXPENSE',
        account_sub_type: 'TAX_EXPENSE',
        total_debits: '400',
        total_credits: '0',
      },
    ]);

    const pl = await ReportsEngine.getProfitLoss(db, 1, '2026-04-01', '2026-04-30');

    expect(pl.otherExpenses).toHaveLength(0);
    expect(pl.totalOtherExpenses).toBe(0);
    expect(pl.netProfit).toBe(10000 - 3000 - 1000 - 400);
  });
});
