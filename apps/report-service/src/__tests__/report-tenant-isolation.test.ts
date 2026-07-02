import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { ReportEngine } from '../domain/ReportEngine.js';

function makeDb(rows: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(rows),
  };
}

const TENANT_A = 1;
const TENANT_B = 2;

const REPORT_SLUGS = [
  'sales-register',
  'sales-by-customer',
  'sales-by-item',
  'sales-by-category',
  'sales-by-salesperson',
  'outstanding-receivables',
  'customer-ledger',
  'payment-collection-report',
  'credit-note-report',
  'sales-return-report',
  'delivery-challan-report',
  'quotation-conversion-report',
  'pos-summary-report',
  'top-selling-items',
  'slow-moving-items',
  'customer-statement',
  'loyalty-points-report',
  'discount-report',
  'sales-target-vs-actual',
  'purchase-register',
  'purchase-by-supplier',
  'purchase-by-item',
  'outstanding-payables',
  'supplier-ledger',
  'purchase-order-status',
  'purchase-return-report',
  'grn-report',
  'expense-report',
  'landed-cost-report',
  'supplier-payment-report',
  'price-trend',
  'stock-summary',
  'stock-movement',
  'inventory-valuation',
  'reorder-report',
  'stock-ageing',
  'physical-verification-report',
  'stock-transfer-report',
  'fabric-roll-report',
  'warehouse-wise-stock',
  'stock-ledger',
  'dead-stock-report',
  'adjustment-report',
  'reservation-report',
  'day-book',
  'account-ledger',
  'trial-balance-report',
  'profit-loss-report',
  'balance-sheet-report',
  'cash-flow-report',
  'expense-analysis',
  'bank-book',
  'tds-report',
  'depreciation-schedule',
  'journal-report',
  'profit-center-report',
  'fund-flow',
  'payroll-report',
  'attendance-report',
  'leave-report',
  'employee-master-report',
  'alteration-report',
  'tailor-work-log-report',
  'gst-register',
  'gstr1-report',
  'gstr3b-report',
  'itc-register',
  'gst-payable-report',
  'reverse-charge-report',
  'ar-aging',
  'ap-aging',
];

const BASE_PARAMS = {
  fromDate: '2026-01-01',
  toDate: '2026-06-30',
  asOfDate: '2026-07-01',
  date: '2026-07-01',
  month: '2026-01',
  financialYear: '2025-26',
  customerId: '1',
  supplierId: '1',
  itemId: '1',
  accountId: '1',
  bankAccountId: '1',
  employeeId: '1',
};

describe('ReportEngine — tenant isolation audit (ES-05)', () => {
  let db: ReturnType<typeof makeDb>;
  let engine: ReportEngine;

  beforeEach(() => {
    db = makeDb([]);
    engine = new ReportEngine(db as never);
  });

  for (const slug of REPORT_SLUGS) {
    it(`${slug}: db.execute receives tenantId in SQL template values`, async () => {
      await engine.generate(slug, TENANT_A, BASE_PARAMS);

      expect(db.execute).toHaveBeenCalled();

      const calls = db.execute.mock.calls;
      for (const [sqlArg] of calls) {
        const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
        expect(values).toContain(TENANT_A);
        expect(values).not.toContain(TENANT_B);
      }
    });
  }

  it('ar-aging: tenant A query never receives tenant B id', async () => {
    await engine.generate('ar-aging', TENANT_A, { asOfDate: '2026-07-01' });
    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(TENANT_A);
    expect(values).not.toContain(TENANT_B);
  });

  it('ap-aging: tenant A query never receives tenant B id', async () => {
    await engine.generate('ap-aging', TENANT_A, { asOfDate: '2026-07-01' });
    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(TENANT_A);
    expect(values).not.toContain(TENANT_B);
  });
});
