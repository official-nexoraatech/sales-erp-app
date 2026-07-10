import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { ReportEngine } from '../domain/ReportEngine.js';

const TENANT_A = 1;
const TENANT_B = 2;

function makeDb(rowsPerCall: unknown[][]) {
  const execute = vi.fn();
  for (const rows of rowsPerCall) {
    execute.mockResolvedValueOnce(rows);
  }
  return { execute };
}

describe('ES-17 — Financial statement correctness', () => {
  let engine: ReportEngine;

  // Test 1: P&L — REVENUE 100,000 - EXPENSE 60,000 = NET PROFIT 40,000
  it('profit-loss-report: REVENUE minus EXPENSE equals NET PROFIT', async () => {
    const db = makeDb([[
      { category: 'REVENUE', account_code: '4000', account_name: 'Sales Revenue', amount: '100000' },
      { category: 'OPERATING_EXPENSE', account_code: '5000', account_name: 'Rent Expense', amount: '60000' },
    ]]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('profit-loss-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });

    const revenue = result.rows.filter((r) => r['category'] === 'REVENUE').reduce((s, r) => s + Number(r['amount']), 0);
    const expense = result.rows
      .filter((r) => r['category'] !== 'REVENUE' && r['category'] !== 'OTHER_INCOME')
      .reduce((s, r) => s + Number(r['amount']), 0);

    expect(revenue).toBe(100000);
    expect(expense).toBe(60000);
    expect(revenue - expense).toBe(40000);
  });

  // Test 2: Balance Sheet — Total ASSETS = Total (LIABILITY + EQUITY)
  it('balance-sheet-report: total ASSETS equals total LIABILITY + EQUITY', async () => {
    const db = makeDb([[
      { section: 'ASSET', account_code: '1000', account_name: 'Cash & Bank', amount: '150000' },
      { section: 'LIABILITY', account_code: '2000', account_name: 'Accounts Payable', amount: '50000' },
      { section: 'EQUITY', account_code: '3000', account_name: 'Owner Capital', amount: '100000' },
    ]]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('balance-sheet-report', TENANT_A, { asOfDate: '2026-06-30' });

    const totalAssets = result.rows.filter((r) => r['section'] === 'ASSET').reduce((s, r) => s + Number(r['amount']), 0);
    const totalLiabilitiesAndEquity = result.rows
      .filter((r) => r['section'] === 'LIABILITY' || r['section'] === 'EQUITY')
      .reduce((s, r) => s + Number(r['amount']), 0);

    expect(totalAssets).toBe(150000);
    expect(totalLiabilitiesAndEquity).toBe(150000);
  });

  // Test 3: Trial Balance — Total DEBIT = Total CREDIT
  it('trial-balance-report: total closing DEBIT equals total closing CREDIT', async () => {
    const db = makeDb([[
      { account_code: '1000', account_name: 'Cash', opening_balance: '0', opening_balance_type: 'DEBIT', pre_debit: '0', pre_credit: '0', period_debit: '500', period_credit: '0' },
      { account_code: '4000', account_name: 'Sales Revenue', opening_balance: '0', opening_balance_type: 'CREDIT', pre_debit: '0', pre_credit: '0', period_debit: '0', period_credit: '500' },
    ]]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('trial-balance-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });

    const totalDebit = result.rows.reduce((s, r) => s + Number(r['closingDebit']), 0);
    const totalCredit = result.rows.reduce((s, r) => s + Number(r['closingCredit']), 0);

    expect(totalDebit).toBe(500);
    expect(totalCredit).toBe(500);
    expect(totalDebit).toBe(totalCredit);
  });

  // Test 4: Tenant isolation — P&L for tenant A never leaks tenant B's id into the query
  it('profit-loss-report: tenant isolation — query values contain TENANT_A, never TENANT_B', async () => {
    const db = makeDb([[]]);
    engine = new ReportEngine(db as never);

    await engine.generate('profit-loss-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(TENANT_A);
    expect(values).not.toContain(TENANT_B);
  });

  // Test 5: Sales analytics — 12-month revenue trend has 12 data points
  it('sales-revenue-trend: returns 12 monthly data points and defaults to a trailing 12-month window', async () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `2025-${String(((i + 7) % 12) + 1).padStart(2, '0')}`,
      invoice_count: 5 + i,
      revenue: String(10000 * (i + 1)),
    }));
    const db = makeDb([months]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('sales-revenue-trend', TENANT_A, {});

    expect(result.rows).toHaveLength(12);

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    const expectedFrom = (() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 11);
      d.setUTCDate(1);
      return d.toISOString().slice(0, 10);
    })();
    expect(values).toContain(expectedFrom);
  });

  // Test 6: Inventory analytics — item with zero stock shows 'STOCKOUT' status
  it("inventory-analytics: item with zero stock is classified as 'STOCKOUT'", async () => {
    const db = makeDb([[
      { item_code: 'SKU-001', item_name: 'Cotton Shirt', category: 'Shirts', current_stock: '0', days_of_supply: null, last_sale_date: '2026-05-15', status: 'STOCKOUT' },
      { item_code: 'SKU-002', item_name: 'Denim Jeans', category: 'Jeans', current_stock: '40', days_of_supply: '20.0', last_sale_date: '2026-06-28', status: 'FAST' },
    ]]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('inventory-analytics', TENANT_A, {});

    const stockoutItem = result.rows.find((r) => r['itemCode'] === 'SKU-001');
    expect(stockoutItem).toBeDefined();
    expect(stockoutItem!['status']).toBe('STOCKOUT');
    expect(Number(stockoutItem!['currentStock'])).toBe(0);
  });
});

describe('ES-17 — cash-flow-report', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes closing cash as opening cash plus net movement', async () => {
    const db = makeDb([
      [{ total_in: '80000', total_out: '30000' }],
      [{ balance: '20000' }],
    ]);
    const engine = new ReportEngine(db as never);

    const result = await engine.generate('cash-flow-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });

    const summary = Object.fromEntries(result.rows.map((r) => [r['description'], Number(r['amount'])]));
    expect(summary['Net Cash Movement']).toBe(50000);
    expect(summary['Opening Cash & Bank Balance']).toBe(20000);
    expect(summary['Closing Cash & Bank Balance']).toBe(70000);
  });
});

describe('ES-26 (M5) — profit-loss-report CONTRA account categorization', () => {
  it('categorizes a CONTRA account as CONTRA_REVENUE (not OTHER) and nets it into COGS matching accounting-service math', async () => {
    const db = makeDb([[
      { category: 'REVENUE', account_code: '4000', account_name: 'Sales Revenue', amount: '200000' },
      { category: 'COGS', account_code: '5000', account_name: 'Cost of Goods Sold', amount: '50000' },
      { category: 'CONTRA_REVENUE', account_code: '4900', account_name: 'Sales Returns & Allowances', amount: '5000' },
      { category: 'OPERATING_EXPENSE', account_code: '6000', account_name: 'Rent Expense', amount: '30000' },
    ]]);
    const engine = new ReportEngine(db as never);

    const result = await engine.generate('profit-loss-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });

    const contraRow = result.rows.find((r) => r['accountCode'] === '4900');
    expect(contraRow?.['category']).toBe('CONTRA_REVENUE');
    expect(contraRow?.['category']).not.toBe('OTHER');

    // Replicates accounting-service's ReportsEngine.getProfitLoss bucketing exactly:
    // totalCogs = cogs + contraRevenue; netProfit = grossProfit - operatingExpenses (no other income/charges here).
    const sum = (cat: string) => result.rows.filter((r) => r['category'] === cat).reduce((s, r) => s + Number(r['amount']), 0);
    const totalRevenue = sum('REVENUE');
    const totalCogs = sum('COGS') + sum('CONTRA_REVENUE');
    const grossProfit = totalRevenue - totalCogs;
    const netProfit = grossProfit - sum('OPERATING_EXPENSE');

    expect(netProfit).toBe(115000);
  });
});

describe('ES-26 (M6) — broken report columns fixed', () => {
  // No live Postgres is available in this environment, so instead of mocking db.execute to
  // return fabricated rows (which is exactly what let the original entry_date/debit_credit/amount
  // bug through undetected — see ES-17_COMPLETION.md), these assert on the generated SQL text
  // itself: the real financial_entries columns are debit_amount/credit_amount/created_at.
  function generatedSql(db: ReturnType<typeof makeDb>): string {
    const [sqlArg] = db.execute.mock.calls[0]!;
    return (sqlArg as { strings: TemplateStringsArray }).strings.join('');
  }

  const cases: Array<{ slug: string; params: Record<string, string | number> }> = [
    { slug: 'day-book', params: { date: '2026-06-01' } },
    { slug: 'account-ledger', params: { fromDate: '2026-04-01', toDate: '2026-06-30', accountId: 1 } },
    { slug: 'expense-analysis', params: { fromDate: '2026-04-01', toDate: '2026-06-30' } },
    { slug: 'bank-book', params: { fromDate: '2026-04-01', toDate: '2026-06-30', bankAccountId: 1 } },
    { slug: 'fund-flow', params: { fromDate: '2026-04-01', toDate: '2026-06-30' } },
  ];

  it.each(cases)('$slug references real financial_entries columns, never the nonexistent ones', async ({ slug, params }) => {
    const db = makeDb([[]]);
    const engine = new ReportEngine(db as never);

    await engine.generate(slug, TENANT_A, params);

    const sqlText = generatedSql(db);
    expect(sqlText).toContain('fe.created_at');
    expect(sqlText).not.toContain('fe.entry_date');
    expect(sqlText).not.toContain('fe.debit_credit');
    expect(sqlText).not.toContain('fe.amount');
  });
});

describe('ES-26 (M7) — gst-payable-report cache', () => {
  function makeFakeRedis() {
    const store = new Map<string, string>();
    return {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      setex: vi.fn(async (key: string, _ttl: number, value: string) => { store.set(key, value); }),
    };
  }

  it('a second call within the TTL is served from cache and does not re-query Postgres', async () => {
    const rows = [{ gst_type: 'CGST', output_tax: '1000', itc_available: '200', net_payable: '800' }];
    const db = makeDb([rows]);
    const redis = makeFakeRedis();
    const engine = new ReportEngine(db as never, redis as never);
    const params = { fromDate: '2026-04-01', toDate: '2026-06-30' };

    const first = await engine.generate('gst-payable-report', TENANT_A, params);
    const second = await engine.generate('gst-payable-report', TENANT_A, params);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(second.rows).toEqual(first.rows);
  });

  it('a different date range is cached independently and does re-query Postgres', async () => {
    const db = makeDb([
      [{ gst_type: 'CGST', output_tax: '1000', itc_available: '0', net_payable: '1000' }],
      [{ gst_type: 'CGST', output_tax: '2000', itc_available: '0', net_payable: '2000' }],
    ]);
    const redis = makeFakeRedis();
    const engine = new ReportEngine(db as never, redis as never);

    await engine.generate('gst-payable-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });
    await engine.generate('gst-payable-report', TENANT_A, { fromDate: '2026-07-01', toDate: '2026-09-30' });

    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('falls back to Postgres when no Redis client is configured', async () => {
    const rows = [{ gst_type: 'CGST', output_tax: '1000', itc_available: '0', net_payable: '1000' }];
    const db = makeDb([rows, rows]);
    const engine = new ReportEngine(db as never); // no redis passed

    await engine.generate('gst-payable-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });
    await engine.generate('gst-payable-report', TENANT_A, { fromDate: '2026-04-01', toDate: '2026-06-30' });

    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
