import { and, eq, inArray } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { gstLedger, gstReturnFilings } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'gst-service' });

type GstLedgerRow = typeof gstLedger.$inferSelect;
type GstFilingRow = typeof gstReturnFilings.$inferSelect;
type AmountCol = 'taxableAmount' | 'cgstAmount' | 'sgstAmount' | 'igstAmount' | 'cessAmount';

// PG-040 — the shape persisted into gst_return_filings.filingData by
// GstReturnTrackerService.markFiled / Gstr3bService.deriveDischargeData.
interface Gstr3bFilingData {
  cashRequired?: { igst: number; cgst: number; sgst: number };
  itcUtilized?: { igst: number; cgst: number; sgst: number };
}

export interface GSTR9Table4 {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface GSTR9Table5 {
  taxableValue: number;
}

export interface GSTR9ItcBucket {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface GSTR9Table6 {
  inwardSupplies: GSTR9ItcBucket;
  rcm: GSTR9ItcBucket;
  total: GSTR9ItcBucket;
}

export interface GSTR9TaxHeadAmounts {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
}

// The real GSTR-9 form's Table 9 has separate "paid in cash" and "paid through ITC" rows
// per tax head — these are genuinely different figures (cash-ledger debit vs ITC-ledger
// utilization), not a single number, so this replaces the old flat {igst,cgst,sgst,cess,total}.
export interface GSTR9Table9 {
  paidInCash: GSTR9TaxHeadAmounts;
  paidThroughItc: GSTR9TaxHeadAmounts;
}

export interface GSTR9Data {
  financialYear: string;
  periods: string[];
  table4: GSTR9Table4;
  table5: GSTR9Table5;
  table6: GSTR9Table6;
  table7: GSTR9ItcBucket;
  table9: GSTR9Table9;
  // PG-040 — whether every period in the FY has a real persisted discharge figure. When
  // false, table9 only reflects the periods actually filed (listed as filed, i.e. absent
  // from unfiledPeriods) — it does not silently substitute Table 4 for the rest.
  table9Complete: boolean;
  unfiledPeriods: string[];
}

export class GSTR9Engine {
  // Indian financial year "2025-26" → Apr 2025 .. Mar 2026
  static periodsForFY(financialYear: string): string[] {
    const startYear = parseInt(financialYear.split('-')[0] ?? '', 10);
    const periods: string[] = [];
    for (let m = 4; m <= 12; m++) periods.push(`${startYear}-${String(m).padStart(2, '0')}`);
    for (let m = 1; m <= 3; m++) periods.push(`${startYear + 1}-${String(m).padStart(2, '0')}`);
    return periods;
  }

  static async generateGSTR9(
    db: TenantScopedDatabase,
    tenantId: number,
    financialYear: string
  ): Promise<GSTR9Data> {
    const periods = GSTR9Engine.periodsForFY(financialYear);
    logger.info({ tenantId, financialYear }, 'Computing GSTR-9');

    const rows: GstLedgerRow[] = await db.raw
      .select()
      .from(gstLedger)
      .where(and(eq(gstLedger.tenantId, tenantId), inArray(gstLedger.periodMonth, periods)));

    const n = (v: unknown): number => Number(v ?? 0);
    const sum = (r: GstLedgerRow[], col: AmountCol): number => r.reduce((acc, row) => acc + n(row[col]), 0);

    const sales = rows.filter((r) => r.entryType === 'SALES_INVOICE');
    const creditNotes = rows.filter((r) => r.entryType === 'CREDIT_NOTE');
    const purchases = rows.filter((r) => r.entryType === 'PURCHASE');
    const purchaseReturns = rows.filter((r) => r.entryType === 'PURCHASE_RETURN');

    // ── Table 4 — Taxable outward supplies (net of credit notes) ──────────────
    const taxableSales = sales.filter((r) => n(r.gstRate) > 0);
    const taxableCreditNotes = creditNotes.filter((r) => n(r.gstRate) > 0);
    const table4: GSTR9Table4 = {
      taxableValue: round2(sum(taxableSales, 'taxableAmount') - sum(taxableCreditNotes, 'taxableAmount')),
      cgst: round2(sum(taxableSales, 'cgstAmount') - sum(taxableCreditNotes, 'cgstAmount')),
      sgst: round2(sum(taxableSales, 'sgstAmount') - sum(taxableCreditNotes, 'sgstAmount')),
      igst: round2(sum(taxableSales, 'igstAmount') - sum(taxableCreditNotes, 'igstAmount')),
      cess: round2(sum(taxableSales, 'cessAmount') - sum(taxableCreditNotes, 'cessAmount')),
      total: 0,
    };
    table4.total = round2(table4.cgst + table4.sgst + table4.igst + table4.cess);

    // ── Table 5 — Nil-rated / exempt / non-GST outward supplies ────────────────
    const nilSales = sales.filter((r) => n(r.gstRate) === 0);
    const table5: GSTR9Table5 = { taxableValue: round2(sum(nilSales, 'taxableAmount')) };

    // ── Table 6 — ITC availed, split ordinary inward supplies vs RCM ──────────
    const rcmPurchases = purchases.filter((r) => r.rcmApplicable);
    const ordinaryPurchases = purchases.filter((r) => !r.rcmApplicable);
    const inwardSupplies: GSTR9ItcBucket = {
      igst: round2(sum(ordinaryPurchases, 'igstAmount')),
      cgst: round2(sum(ordinaryPurchases, 'cgstAmount')),
      sgst: round2(sum(ordinaryPurchases, 'sgstAmount')),
      cess: round2(sum(ordinaryPurchases, 'cessAmount')),
    };
    const rcm: GSTR9ItcBucket = {
      igst: round2(sum(rcmPurchases, 'igstAmount')),
      cgst: round2(sum(rcmPurchases, 'cgstAmount')),
      sgst: round2(sum(rcmPurchases, 'sgstAmount')),
      cess: round2(sum(rcmPurchases, 'cessAmount')),
    };
    const table6: GSTR9Table6 = {
      inwardSupplies,
      rcm,
      total: {
        igst: round2(inwardSupplies.igst + rcm.igst),
        cgst: round2(inwardSupplies.cgst + rcm.cgst),
        sgst: round2(inwardSupplies.sgst + rcm.sgst),
        cess: round2(inwardSupplies.cess + rcm.cess),
      },
    };

    // ── Table 7 — ITC reversed (purchase returns + explicitly ineligible purchases) ─
    const ineligiblePurchases = purchases.filter((r) => !r.itcEligible);
    const table7: GSTR9ItcBucket = {
      igst: round2(sum(purchaseReturns, 'igstAmount') + sum(ineligiblePurchases, 'igstAmount')),
      cgst: round2(sum(purchaseReturns, 'cgstAmount') + sum(ineligiblePurchases, 'cgstAmount')),
      sgst: round2(sum(purchaseReturns, 'sgstAmount') + sum(ineligiblePurchases, 'sgstAmount')),
      cess: round2(sum(purchaseReturns, 'cessAmount') + sum(ineligiblePurchases, 'cessAmount')),
    };

    // ── Table 9 — Tax paid ──────────────────────────────────────────────────────
    // Real per-period cash/ITC discharge, persisted into gst_return_filings.filingData at
    // GSTR-3B filing time (see GstReturnTrackerService.markFiled and
    // Gstr3bService.deriveDischargeData), summed across the FY's filed periods — NOT a
    // copy of Table 4's liability figure (PG-040). Periods with no persisted filingData
    // (not yet filed, or filed before this tracking existed) are excluded from the sum and
    // listed in unfiledPeriods rather than silently substituted, so a partial FY reports an
    // honest partial total instead of a fabricated complete one. Cess isn't included because
    // computeItcSetoff has no cess set-off engine (matches its existing scope limitation).
    const filingRows: GstFilingRow[] = await db.raw
      .select()
      .from(gstReturnFilings)
      .where(
        and(
          eq(gstReturnFilings.tenantId, tenantId),
          eq(gstReturnFilings.returnType, 'GSTR3B'),
          inArray(gstReturnFilings.period, periods)
        )
      );

    const paidInCash = { igst: 0, cgst: 0, sgst: 0 };
    const paidThroughItc = { igst: 0, cgst: 0, sgst: 0 };
    const unfiledPeriods: string[] = [];

    for (const period of periods) {
      const filing = filingRows.find((f) => f.period === period);
      const isFiled = filing?.status === 'FILED' || filing?.status === 'LATE_FILED';
      const filingData = filing?.filingData as Gstr3bFilingData | null | undefined;

      if (isFiled && filingData?.cashRequired && filingData?.itcUtilized) {
        paidInCash.igst += n(filingData.cashRequired.igst);
        paidInCash.cgst += n(filingData.cashRequired.cgst);
        paidInCash.sgst += n(filingData.cashRequired.sgst);
        paidThroughItc.igst += n(filingData.itcUtilized.igst);
        paidThroughItc.cgst += n(filingData.itcUtilized.cgst);
        paidThroughItc.sgst += n(filingData.itcUtilized.sgst);
      } else {
        unfiledPeriods.push(period);
      }
    }

    const table9: GSTR9Table9 = {
      paidInCash: {
        igst: round2(paidInCash.igst),
        cgst: round2(paidInCash.cgst),
        sgst: round2(paidInCash.sgst),
        cess: 0,
        total: round2(paidInCash.igst + paidInCash.cgst + paidInCash.sgst),
      },
      paidThroughItc: {
        igst: round2(paidThroughItc.igst),
        cgst: round2(paidThroughItc.cgst),
        sgst: round2(paidThroughItc.sgst),
        cess: 0,
        total: round2(paidThroughItc.igst + paidThroughItc.cgst + paidThroughItc.sgst),
      },
    };

    return {
      financialYear,
      periods,
      table4,
      table5,
      table6,
      table7,
      table9,
      table9Complete: unfiledPeriods.length === 0,
      unfiledPeriods,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
