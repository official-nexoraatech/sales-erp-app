import { describe, it, expect, vi } from 'vitest';
import { ReportsEngine } from '../domain/ReportsEngine.js';

// ReportsEngine.getPnLByCostCenter issues one raw SQL query grouped by
// (cost_center_id, account_type, account_sub_type) — db.raw.execute() mocked
// with a fixture row set, no real Postgres connection needed.

type Row = {
  cost_center_id: number | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  account_type: string;
  account_sub_type: string | null;
  total_debits: string;
  total_credits: string;
};

function makeDb(rows: Row[]) {
  return { raw: { execute: vi.fn().mockResolvedValue(rows) } } as never;
}

describe('ReportsEngine.getPnLByCostCenter', () => {
  it('slices revenue/cogs/opex/otherExpenses per cost center and computes netProfit', async () => {
    const db = makeDb([
      {
        cost_center_id: 1,
        cost_center_code: 'TAIL',
        cost_center_name: 'Tailoring',
        account_type: 'INCOME',
        account_sub_type: 'SALES_REVENUE',
        total_debits: '0',
        total_credits: '10000',
      },
      {
        cost_center_id: 1,
        cost_center_code: 'TAIL',
        cost_center_name: 'Tailoring',
        account_type: 'EXPENSE',
        account_sub_type: 'COST_OF_GOODS',
        total_debits: '4000',
        total_credits: '0',
      },
      {
        cost_center_id: 1,
        cost_center_code: 'TAIL',
        cost_center_name: 'Tailoring',
        account_type: 'EXPENSE',
        account_sub_type: 'OPERATING_EXPENSE',
        total_debits: '1500',
        total_credits: '0',
      },
      {
        cost_center_id: null,
        cost_center_code: null,
        cost_center_name: null,
        account_type: 'INCOME',
        account_sub_type: 'SALES_REVENUE',
        total_debits: '0',
        total_credits: '2000',
      },
    ]);

    const report = await ReportsEngine.getPnLByCostCenter(db, 1, '2026-04-01', '2026-04-30');

    expect(report.lines).toHaveLength(2);
    const tailoring = report.lines.find((l) => l.costCenterId === 1)!;
    expect(tailoring.revenue).toBe(10000);
    expect(tailoring.cogs).toBe(4000);
    expect(tailoring.operatingExpenses).toBe(1500);
    expect(tailoring.otherExpenses).toBe(0);
    expect(tailoring.netProfit).toBe(4500);

    const unassigned = report.lines.find((l) => l.costCenterId === null)!;
    expect(unassigned.costCenterName).toBeNull();
    expect(unassigned.revenue).toBe(2000);
    expect(unassigned.netProfit).toBe(2000);
  });

  it('returns an empty lines array (not an error) when no postings are tagged in range', async () => {
    const db = makeDb([]);
    const report = await ReportsEngine.getPnLByCostCenter(db, 1, '2026-04-01', '2026-04-30');
    expect(report.lines).toEqual([]);
  });

  it('routes non-COGS/non-OPERATING_EXPENSE expense/contra sub-types into otherExpenses', async () => {
    const db = makeDb([
      {
        cost_center_id: 2,
        cost_center_code: 'HQ',
        cost_center_name: 'Head Office',
        account_type: 'EXPENSE',
        account_sub_type: 'TAX_EXPENSE',
        total_debits: '300',
        total_credits: '0',
      },
    ]);

    const report = await ReportsEngine.getPnLByCostCenter(db, 1, '2026-04-01', '2026-04-30');
    expect(report.lines[0]!.otherExpenses).toBe(300);
    expect(report.lines[0]!.netProfit).toBe(-300);
  });
});
