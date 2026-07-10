import { describe, it, expect, vi } from 'vitest';
import { ReportsEngine } from '../domain/ReportsEngine.js';

// ReportsEngine.getCashFlow issues two raw SQL queries in order:
//   1) the classified cash-movement rows (net_amount + counter_sub_type)
//   2) the opening cash balance
// Both go through db.raw.execute(), so a fake db that returns queued
// fixture arrays is enough — no real Postgres connection needed.

type ClassifiedRow = { net_amount: string; counter_sub_type: string | null };

function makeDb(classifiedRows: ClassifiedRow[], openingBalance: number) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(classifiedRows)
    .mockResolvedValueOnce([{ balance: String(openingBalance) }]);
  return { raw: { execute } } as never;
}

describe('ReportsEngine.getCashFlow', () => {
  it('operating-only regression: no fixed-asset/loan/equity counter-accounts stay entirely in Operating', async () => {
    const db = makeDb(
      [
        { net_amount: '5000', counter_sub_type: 'ACCOUNTS_RECEIVABLE' }, // customer receipt
        { net_amount: '-2000', counter_sub_type: 'ACCOUNTS_PAYABLE' }, // supplier payment
      ],
      1000
    );

    const report = await ReportsEngine.getCashFlow(db, 1, '2026-04-01', '2026-04-30');

    expect(report.operatingActivities).toEqual([
      { label: 'Cash received from customers', amount: 5000 },
      { label: 'Cash paid to suppliers', amount: -2000 },
    ]);
    expect(report.netOperating).toBe(3000);
    expect(report.investingActivities).toEqual([]);
    expect(report.netInvesting).toBe(0);
    expect(report.financingActivities).toEqual([]);
    expect(report.netFinancing).toBe(0);
    expect(report.openingCash).toBe(1000);
    expect(report.netCashMovement).toBe(3000);
    expect(report.closingCash).toBe(4000);
  });

  it('a fixed-asset purchase (cash outflow, counter FIXED_ASSET) is routed to Investing, not Operating', async () => {
    const db = makeDb(
      [
        { net_amount: '5000', counter_sub_type: 'ACCOUNTS_RECEIVABLE' },
        { net_amount: '-15000', counter_sub_type: 'FIXED_ASSET' },
      ],
      1000
    );

    const report = await ReportsEngine.getCashFlow(db, 1, '2026-04-01', '2026-04-30');

    expect(report.operatingActivities).toEqual([
      { label: 'Cash received from customers', amount: 5000 },
      { label: 'Cash paid to suppliers', amount: 0 },
    ]);
    expect(report.investingActivities).toEqual([
      { label: 'Purchase of fixed assets', amount: -15000 },
    ]);
    expect(report.netInvesting).toBe(-15000);
  });

  it('a fixed-asset disposal (cash inflow via FixedAssetService.dispose, counter FIXED_ASSET) is routed to Investing', async () => {
    // FixedAssetService.dispose() credits the asset's FIXED_ASSET account for the
    // asset cost and debits the cash/bank account passed as gainLossAccountId for
    // the disposal proceeds — the dominant (first) non-cash counter-line in that
    // journal is the FIXED_ASSET line, per the "first non-cash account" rule.
    const db = makeDb([{ net_amount: '8000', counter_sub_type: 'FIXED_ASSET' }], 1000);

    const report = await ReportsEngine.getCashFlow(db, 1, '2026-04-01', '2026-04-30');

    expect(report.investingActivities).toEqual([
      { label: 'Proceeds from disposal of fixed assets', amount: 8000 },
    ]);
    expect(report.netInvesting).toBe(8000);
    expect(report.operatingActivities).toEqual([
      { label: 'Cash received from customers', amount: 0 },
      { label: 'Cash paid to suppliers', amount: 0 },
    ]);
  });

  it('a bank-loan drawdown (counter LONG_TERM_LIABILITY) and owner-capital injection/drawings (counter EQUITY) are routed to Financing', async () => {
    const db = makeDb(
      [
        { net_amount: '50000', counter_sub_type: 'LONG_TERM_LIABILITY' }, // loan received
        { net_amount: '-10000', counter_sub_type: 'LONG_TERM_LIABILITY' }, // loan repaid
        { net_amount: '20000', counter_sub_type: 'EQUITY' }, // capital introduced
        { net_amount: '-3000', counter_sub_type: 'EQUITY' }, // owner drawings
      ],
      0
    );

    const report = await ReportsEngine.getCashFlow(db, 1, '2026-04-01', '2026-04-30');

    expect(report.financingActivities).toEqual(
      expect.arrayContaining([
        { label: 'Bank loan received', amount: 50000 },
        { label: 'Bank loan repaid', amount: -10000 },
        { label: "Owner's capital introduced", amount: 20000 },
        { label: "Owner's drawings", amount: -3000 },
      ])
    );
    expect(report.netFinancing).toBe(57000);
  });

  it('cash-to-cash transfers (counter is also CASH_AND_BANK) fall through to Operating, not double-counted', async () => {
    const db = makeDb(
      [
        { net_amount: '-5000', counter_sub_type: null }, // withdrawal leg (LEFT JOIN LATERAL found no non-cash counter)
        { net_amount: '5000', counter_sub_type: null }, // deposit leg
      ],
      1000
    );

    const report = await ReportsEngine.getCashFlow(db, 1, '2026-04-01', '2026-04-30');

    expect(report.netOperating).toBe(0);
    expect(report.netCashMovement).toBe(0);
    expect(report.closingCash).toBe(1000);
  });

  it('netOperating + netInvesting + netFinancing always equals netCashMovement (mixed period)', async () => {
    const db = makeDb(
      [
        { net_amount: '5000', counter_sub_type: 'ACCOUNTS_RECEIVABLE' },
        { net_amount: '-2000', counter_sub_type: 'ACCOUNTS_PAYABLE' },
        { net_amount: '-15000', counter_sub_type: 'FIXED_ASSET' },
        { net_amount: '8000', counter_sub_type: 'FIXED_ASSET' },
        { net_amount: '50000', counter_sub_type: 'LONG_TERM_LIABILITY' },
        { net_amount: '20000', counter_sub_type: 'EQUITY' },
        { net_amount: '-3000', counter_sub_type: 'EQUITY' },
      ],
      1000
    );

    const report = await ReportsEngine.getCashFlow(db, 1, '2026-04-01', '2026-04-30');

    expect(report.netOperating + report.netInvesting + report.netFinancing).toBe(report.netCashMovement);
    expect(report.closingCash).toBe(report.openingCash + report.netCashMovement);
  });
});
