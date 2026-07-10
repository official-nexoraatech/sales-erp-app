/**
 * ES-10 — GST Compliance: Cess & GSTR-9
 * Covers: core CGST/SGST/IGST split, cess calculation, and GSTR-9 table computation
 * + tenant isolation. RCM detection on GRN creation is tested in
 * apps/purchase-service/src/__tests__/rcm.test.ts since that's where the actual
 * RCM logic lives (GRNService, not gst-service) — see ES-10 completion report.
 */

import { describe, it, expect, vi } from 'vitest';
import { GSTCalculator } from '../domain/GSTCalculator.js';

describe('GSTCalculator.compute', () => {
  it('1. intra-state 18% GST on ₹10,000 → CGST 900 + SGST 900 + IGST 0 + Cess 0', () => {
    const result = GSTCalculator.compute({ taxableAmount: 10000, gstRate: 18, isInterstate: false });
    expect(result.cgstAmount).toBe(900);
    expect(result.sgstAmount).toBe(900);
    expect(result.igstAmount).toBe(0);
    expect(result.cessAmount).toBe(0);
  });

  it('2. inter-state 18% GST on ₹10,000 → CGST 0 + SGST 0 + IGST 1,800', () => {
    const result = GSTCalculator.compute({ taxableAmount: 10000, gstRate: 18, isInterstate: true });
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstAmount).toBe(1800);
  });

  it('3. intra-state with 3% cess → Cess = round(10000 * 3 / 100) = 300', () => {
    const result = GSTCalculator.compute({ taxableAmount: 10000, gstRate: 18, cessRate: 3, isInterstate: false });
    expect(result.cessAmount).toBe(300);
  });
});

// ── GSTR-9 (Tests 5, 6, 7) ──────────────────────────────────────────────────────
type Cond = { type: 'and'; args: Cond[] } | { type: 'eq'; col: string; val: unknown } | { type: 'inArray'; col: string; vals: unknown[] };

vi.mock('drizzle-orm', () => ({
  and: (...args: Cond[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  inArray: (col: string, vals: unknown[]) => ({ type: 'inArray', col, vals }),
}));

vi.mock('@erp/db', () => ({
  gstLedger: { tenantId: 'tenantId', periodMonth: 'periodMonth' },
  gstReturnFilings: { tenantId: 'tenantId', returnType: 'returnType', period: 'period' },
}));

function evalCond(cond: Cond, row: Record<string, unknown>): boolean {
  if (cond.type === 'and') return cond.args.every((c) => evalCond(c, row));
  if (cond.type === 'eq') return row[cond.col] === cond.val;
  if (cond.type === 'inArray') return cond.vals.includes(row[cond.col]);
  return true;
}

function makeDb(rows: Record<string, unknown>[]) {
  return {
    raw: {
      select: () => ({
        from: () => ({
          where: (cond: Cond) => Promise.resolve(rows.filter((r) => evalCond(cond, r))),
        }),
      }),
    },
  };
}

const FY = '2025-26';
const PERIOD = '2025-06';

function ledgerRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tenantId: 1,
    periodMonth: PERIOD,
    entryType: 'SALES_INVOICE',
    gstRate: '18',
    taxableAmount: '0',
    cgstAmount: '0',
    sgstAmount: '0',
    igstAmount: '0',
    cessAmount: '0',
    itcEligible: true,
    rcmApplicable: false,
    ...overrides,
  };
}

describe('GSTR9Engine.generateGSTR9', () => {
  it('5. table 4 taxable outward supplies matches confirmed invoices', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const rows = [
      ledgerRow({ tenantId: 1, entryType: 'SALES_INVOICE', taxableAmount: '1000', cgstAmount: '90', sgstAmount: '90' }),
      ledgerRow({ tenantId: 1, entryType: 'SALES_INVOICE', taxableAmount: '2000', cgstAmount: '180', sgstAmount: '180' }),
    ];
    const result = await GSTR9Engine.generateGSTR9(makeDb(rows) as never, 1, FY);
    expect(result.table4.taxableValue).toBe(3000);
    expect(result.table4.cgst).toBe(270);
    expect(result.table4.sgst).toBe(270);
  });

  it('6. table 6 ITC sum matches confirmed vendor invoices (ordinary + RCM split)', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const rows = [
      ledgerRow({ tenantId: 1, entryType: 'PURCHASE', taxableAmount: '5000', cgstAmount: '450', sgstAmount: '450', rcmApplicable: false }),
      ledgerRow({ tenantId: 1, entryType: 'PURCHASE', taxableAmount: '1000', cgstAmount: '90', sgstAmount: '90', rcmApplicable: true }),
    ];
    const result = await GSTR9Engine.generateGSTR9(makeDb(rows) as never, 1, FY);
    expect(result.table6.inwardSupplies.cgst).toBe(450);
    expect(result.table6.rcm.cgst).toBe(90);
    expect(result.table6.total.cgst).toBe(540);
  });

  it('7. tenant isolation — GSTR-9 for tenant A returns zero tenant B data', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const rows = [
      ledgerRow({ tenantId: 1, entryType: 'SALES_INVOICE', taxableAmount: '1000' }),
      ledgerRow({ tenantId: 2, entryType: 'SALES_INVOICE', taxableAmount: '99999' }),
    ];
    const result = await GSTR9Engine.generateGSTR9(makeDb(rows) as never, 1, FY);
    expect(result.table4.taxableValue).toBe(1000);
  });
});

// ── PG-040 — Table 9 real tax-paid tracking ─────────────────────────────────────
function filingRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tenantId: 1,
    returnType: 'GSTR3B',
    status: 'FILED',
    filingData: null,
    ...overrides,
  };
}

describe('GSTR9Engine.generateGSTR9 — Table 9 tax paid (PG-040)', () => {
  it('8. sums only persisted per-period discharge figures for filed periods, flags the rest as unfiled', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const rows = [
      filingRow({
        period: '2025-04',
        status: 'FILED',
        filingData: { cashRequired: { igst: 100, cgst: 50, sgst: 50 }, itcUtilized: { igst: 10, cgst: 5, sgst: 5 } },
      }),
      filingRow({
        period: '2025-05',
        status: 'LATE_FILED',
        filingData: { cashRequired: { igst: 200, cgst: 0, sgst: 0 }, itcUtilized: { igst: 0, cgst: 0, sgst: 0 } },
      }),
    ];
    const result = await GSTR9Engine.generateGSTR9(makeDb(rows) as never, 1, FY);

    expect(result.table9.paidInCash.igst).toBe(300);
    expect(result.table9.paidInCash.cgst).toBe(50);
    expect(result.table9.paidThroughItc.igst).toBe(10);
    expect(result.table9Complete).toBe(false);
    expect(result.unfiledPeriods).toHaveLength(10);
    expect(result.unfiledPeriods).not.toContain('2025-04');
    expect(result.unfiledPeriods).not.toContain('2025-05');
  });

  it('9. a FILED row with no persisted filingData (pre-PG-040 filing) is treated as unfiled, not crashed on', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const rows = [filingRow({ period: '2025-04', status: 'FILED', filingData: null })];
    const result = await GSTR9Engine.generateGSTR9(makeDb(rows) as never, 1, FY);

    expect(result.table9.paidInCash.total).toBe(0);
    expect(result.table9Complete).toBe(false);
    expect(result.unfiledPeriods).toContain('2025-04');
  });

  it('10. all 12 periods filed with persisted data → table9Complete true, unfiledPeriods empty', async () => {
    const { GSTR9Engine } = await import('../domain/GSTR9Engine.js');
    const rows = GSTR9Engine.periodsForFY(FY).map((period) =>
      filingRow({
        period,
        status: 'FILED',
        filingData: { cashRequired: { igst: 10, cgst: 10, sgst: 10 }, itcUtilized: { igst: 1, cgst: 1, sgst: 1 } },
      })
    );
    const result = await GSTR9Engine.generateGSTR9(makeDb(rows) as never, 1, FY);

    expect(result.table9Complete).toBe(true);
    expect(result.unfiledPeriods).toHaveLength(0);
    expect(result.table9.paidInCash.total).toBe(360);
  });
});
