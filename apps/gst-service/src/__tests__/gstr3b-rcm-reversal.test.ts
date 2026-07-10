/**
 * PG-039 — GSTR-3B RCM / import / ITC-reversal bucket computation.
 * Covers the wiring gap fixed in this package: Table 3.1(d)/4A RCM, Table 4B blocked-credit
 * reversal, and the manual import-of-goods/services escape hatch — none of which existed
 * before (all four sub-buckets were hardcoded to zero). See PG-039 gap-prompt file for the
 * full architecture rationale. GstLedgerService.getSummary()'s own RCM/ineligible-purchase
 * grouping is covered separately in gst-ledger-service-summary.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

// GSTR9Engine (used below for the cross-return consistency check) imports drizzle-orm/@erp/db
// for real — mock both so its `gstLedger` column refs don't hit the vitest @erp/db barrel bug.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  inArray: (col: string, vals: unknown[]) => ({ type: 'inArray', col, vals }),
}));

vi.mock('@erp/db', () => ({
  gstLedger: { tenantId: 'tenantId', periodMonth: 'periodMonth' },
  gstReturnFilings: { tenantId: 'tenantId', returnType: 'returnType', period: 'period' },
}));

vi.mock('../domain/GstLedgerService.js', () => ({
  GstLedgerService: { getSummary: vi.fn() },
}));

const ZERO5 = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };

function baseSummary(overrides: Record<string, unknown> = {}) {
  return {
    sales: { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 },
    purchases: { ...ZERO5, itcEligible: 0 },
    creditNotes: { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    purchaseReturns: { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    rcm: { ...ZERO5 },
    ineligiblePurchases: { ...ZERO5 },
    ...overrides,
  };
}

describe('Gstr3bService.compute — RCM bucket', () => {
  it('a PURCHASE row with rcmApplicable=true produces non-zero table31.inwardRcm and table4.itcAvailable.rcm, and feeds computeItcSetoff liability', async () => {
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    vi.mocked(GstLedgerService.getSummary).mockResolvedValue(
      baseSummary({ rcm: { taxable: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0 } }) as never
    );

    const result = await Gstr3bService.compute({} as never, 1, '2025-06');

    expect(result.table31.inwardRcm).toEqual({ igst: 0, cgst: 90, sgst: 90, cess: 0, taxableValue: 1000 });
    expect(result.table4.itcAvailable.rcm).toEqual({ igst: 0, cgst: 90, sgst: 90, cess: 0 });
    // Liability side of set-off must see the RCM amount, not just the display tables.
    expect(result.itcSetoff.cgstLiability).toBe(90);
    expect(result.itcSetoff.sgstLiability).toBe(90);
  });

  it('RCM ITC offsets RCM liability in the same period (cashRequired stays zero when both sides match)', async () => {
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    vi.mocked(GstLedgerService.getSummary).mockResolvedValue(
      baseSummary({ rcm: { taxable: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0 } }) as never
    );

    const result = await Gstr3bService.compute({} as never, 1, '2025-06');

    expect(result.itcSetoff.cashRequired.cgst).toBe(0);
    expect(result.itcSetoff.cashRequired.sgst).toBe(0);
  });
});

describe('Gstr3bService.compute — ITC reversal (blocked credits)', () => {
  it('a PURCHASE row with itcEligible=false produces non-zero table4.itcReversed.rule42_43 and reduces netItcAvailable', async () => {
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    vi.mocked(GstLedgerService.getSummary).mockResolvedValue(
      baseSummary({
        purchases: { taxable: 5000, cgst: 450, sgst: 450, igst: 0, cess: 0, itcEligible: 0 },
        ineligiblePurchases: { taxable: 5000, cgst: 450, sgst: 450, igst: 0, cess: 0 },
      }) as never
    );

    const result = await Gstr3bService.compute({} as never, 1, '2025-06');

    expect(result.table4.itcReversed.rule42_43).toEqual({ igst: 0, cgst: 450, sgst: 450, cess: 0 });
    // inwardSupplies ITC (450/450) is fully wiped out by the same-amount reversal.
    expect(result.table4.netItcAvailable).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('matches GSTR9Engine Table 7 for the same ineligible-purchase data (cross-return consistency)', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');

    // GSTR9Engine sums raw ledger rows in JS; one ineligible PURCHASE row, no purchase
    // returns, so its Table 7 total is exactly the ineligible-purchase amount.
    const rawRows = [
      { tenantId: 1, periodMonth: '2025-06', entryType: 'PURCHASE', gstRate: '18', taxableAmount: '5000', cgstAmount: '450', sgstAmount: '450', igstAmount: '0', cessAmount: '0', itcEligible: false, rcmApplicable: false },
    ];
    const gstr9Db = { raw: { select: () => ({ from: () => ({ where: () => Promise.resolve(rawRows) }) }) } };
    const gstr9Result = await GSTR9Engine.generateGSTR9(gstr9Db as never, 1, '2025-26');

    vi.mocked(GstLedgerService.getSummary).mockResolvedValue(
      baseSummary({ ineligiblePurchases: { taxable: 5000, cgst: 450, sgst: 450, igst: 0, cess: 0 } }) as never
    );
    const gstr3bResult = await Gstr3bService.compute({} as never, 1, '2025-06');

    expect(gstr3bResult.table4.itcReversed.rule42_43.cgst).toBe(gstr9Result.table7.cgst);
    expect(gstr3bResult.table4.itcReversed.rule42_43.sgst).toBe(gstr9Result.table7.sgst);
  });
});

describe('Gstr3bService.compute — manual import-of-goods/services adjustment', () => {
  it('applies a manual adjustment into table4.itcAvailable.importOfGoods/importOfServices', async () => {
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    vi.mocked(GstLedgerService.getSummary).mockResolvedValue(baseSummary() as never);

    const result = await Gstr3bService.compute({} as never, 1, '2025-06', {
      importOfGoodsIgst: 5000,
      importOfServicesIgst: 1200,
    });

    expect(result.table4.itcAvailable.importOfGoods).toEqual({ igst: 5000, cgst: 0, sgst: 0, cess: 0 });
    expect(result.table4.itcAvailable.importOfServices).toEqual({ igst: 1200 });
    expect(result.table4.netItcAvailable.igst).toBe(6200);
  });

  it('stays zero when no manual adjustment is provided', async () => {
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    vi.mocked(GstLedgerService.getSummary).mockResolvedValue(baseSummary() as never);

    const result = await Gstr3bService.compute({} as never, 1, '2025-06');

    expect(result.table4.itcAvailable.importOfGoods.igst).toBe(0);
    expect(result.table4.itcAvailable.importOfServices.igst).toBe(0);
  });
});

describe('Gstr3bService.computeItcSetoff — regression, RCM-only liability', () => {
  it('IGST -> CGST -> SGST set-off order is unchanged when the only liability is RCM (no outward supply)', async () => {
    const { Gstr3bService } = await import('../domain/Gstr3bService.js');

    // No outward IGST liability, but RCM contributed IGST liability of 1000 with only
    // CGST/SGST ITC on hand — must still drain IGST liability via CGST ITC first per the
    // mandated order (IGST liability: IGST ITC -> CGST ITC -> SGST ITC).
    const result = Gstr3bService.computeItcSetoff(
      { igst: 1000, cgst: 0, sgst: 0 },
      { igst: 0, cgst: 600, sgst: 600 }
    );

    expect(result.setoff.igstFromCgst).toBe(600);
    expect(result.setoff.igstFromSgst).toBe(400);
    expect(result.cashRequired.igst).toBe(0);
    expect(result.balanceItc.sgst).toBe(200);
  });
});
