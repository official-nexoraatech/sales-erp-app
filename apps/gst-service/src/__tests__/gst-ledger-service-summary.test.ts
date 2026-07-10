/**
 * PG-039 — GstLedgerService.getSummary()'s new RCM / ineligible-purchase grouping.
 * Before this package, getSummary() only grouped by entryType/itcEligible and never split
 * out RCM purchases (rcmApplicable) from ordinary ones — see gstr3b-rcm-reversal.test.ts for
 * the Gstr3bService-level wiring this feeds into.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  gte: vi.fn(),
  lte: vi.fn(),
  inArray: vi.fn(),
  sql: (strings: TemplateStringsArray) => strings,
}));

vi.mock('@erp/db', () => ({
  gstLedger: {
    id: 'id',
    tenantId: 'tenantId',
    periodMonth: 'periodMonth',
    entryType: 'entryType',
    itcEligible: 'itcEligible',
    rcmApplicable: 'rcmApplicable',
    taxableAmount: 'taxableAmount',
    cgstAmount: 'cgstAmount',
    sgstAmount: 'sgstAmount',
    igstAmount: 'igstAmount',
    cessAmount: 'cessAmount',
    totalGst: 'totalGst',
    documentDate: 'documentDate',
    documentNumber: 'documentNumber',
  },
}));

// Simulates what Postgres hands back after SUM(...)/GROUP BY entryType, itcEligible,
// rcmApplicable — one row per distinct combination, amounts pre-summed as strings.
function makeSummaryDb(groupedRows: Record<string, unknown>[]) {
  return {
    raw: {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: () => Promise.resolve(groupedRows),
          }),
        }),
      }),
    },
  };
}

describe('GstLedgerService.getSummary — RCM and ITC-reversal buckets', () => {
  it('splits RCM purchases out of ordinary purchases into a separate `rcm` bucket', async () => {
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    const rows = [
      { entryType: 'PURCHASE', itcEligible: true, rcmApplicable: false, taxableAmount: '5000', cgstAmount: '450', sgstAmount: '450', igstAmount: '0', cessAmount: '0', totalGst: '900' },
      { entryType: 'PURCHASE', itcEligible: true, rcmApplicable: true, taxableAmount: '1000', cgstAmount: '90', sgstAmount: '90', igstAmount: '0', cessAmount: '0', totalGst: '180' },
    ];
    const summary = await GstLedgerService.getSummary(makeSummaryDb(rows) as never, 1, '2025-06');

    expect(summary.purchases.cgst).toBe(450);
    expect(summary.purchases.sgst).toBe(450);
    expect(summary.rcm.cgst).toBe(90);
    expect(summary.rcm.sgst).toBe(90);
    expect(summary.rcm.taxable).toBe(1000);
  });

  it('sums itcEligible=false PURCHASE rows into `ineligiblePurchases`', async () => {
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    const rows = [
      { entryType: 'PURCHASE', itcEligible: true, rcmApplicable: false, taxableAmount: '2000', cgstAmount: '180', sgstAmount: '180', igstAmount: '0', cessAmount: '0', totalGst: '360' },
      { entryType: 'PURCHASE', itcEligible: false, rcmApplicable: false, taxableAmount: '1000', cgstAmount: '90', sgstAmount: '90', igstAmount: '0', cessAmount: '0', totalGst: '180' },
    ];
    const summary = await GstLedgerService.getSummary(makeSummaryDb(rows) as never, 1, '2025-06');

    expect(summary.ineligiblePurchases.cgst).toBe(90);
    expect(summary.ineligiblePurchases.sgst).toBe(90);
    // Ordinary `purchases` still includes the ineligible row's amount (it's still an
    // ordinary, non-RCM purchase) — only the `itcEligible` sub-total excludes it.
    expect(summary.purchases.cgst).toBe(270);
    expect(summary.purchases.itcEligible).toBe(360); // 180+180 from the eligible row only
  });

  it('an RCM purchase that is also itcEligible=false is excluded from ordinary `purchases` but counted in both `rcm` and `ineligiblePurchases`', async () => {
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    const rows = [
      { entryType: 'PURCHASE', itcEligible: false, rcmApplicable: true, taxableAmount: '1000', cgstAmount: '90', sgstAmount: '90', igstAmount: '0', cessAmount: '0', totalGst: '180' },
    ];
    const summary = await GstLedgerService.getSummary(makeSummaryDb(rows) as never, 1, '2025-06');

    expect(summary.purchases.cgst).toBe(0);
    expect(summary.rcm.cgst).toBe(90);
    expect(summary.ineligiblePurchases.cgst).toBe(90);
  });
});
