import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { gstLedger } from '@erp/db';
import type { NewGstLedgerEntry } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'gst-service' });

export type GstEntryType = 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE' | 'PURCHASE_RETURN';

// Validates GSTIN: 2-digit state code + 10-char PAN + 1 entity + Z + 1 checksum = 15 chars
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

export function validateGstin(gstin: string): boolean {
  return GSTIN_REGEX.test(gstin);
}

export function extractStateCode(gstin: string): string {
  return gstin.substring(0, 2);
}

export class GstLedgerService {
  // Insert a single GST ledger entry idempotently (sourceEventId prevents duplicates)
  static async insertEntry(
    db: TenantScopedDatabase,
    tenantId: number,
    entry: Omit<NewGstLedgerEntry, 'id' | 'tenantId' | 'createdAt'>
  ): Promise<number> {
    if (entry.sourceEventId) {
      const [existing] = await db.raw
        .select({ id: gstLedger.id })
        .from(gstLedger)
        .where(and(eq(gstLedger.tenantId, tenantId), eq(gstLedger.sourceEventId, entry.sourceEventId)));

      if (existing) {
        logger.info({ sourceEventId: entry.sourceEventId }, 'GST ledger: duplicate event skipped');
        return existing.id;
      }
    }

    const [inserted] = await db.raw
      .insert(gstLedger)
      .values({ ...entry, tenantId })
      .returning({ id: gstLedger.id });

    if (!inserted) throw new Error('GST ledger insert failed');
    return inserted.id;
  }

  // List GST register entries for a period
  static async getRegister(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string, // YYYY-MM
    type: 'SALES' | 'PURCHASE' | 'ALL'
  ): Promise<typeof gstLedger.$inferSelect[]> {
    const typeFilter: GstEntryType[] =
      type === 'SALES'
        ? ['SALES_INVOICE', 'CREDIT_NOTE']
        : type === 'PURCHASE'
          ? ['PURCHASE', 'PURCHASE_RETURN']
          : ['SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE', 'PURCHASE_RETURN'];

    return db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.periodMonth, period),
          inArray(gstLedger.entryType, typeFilter)
        )
      )
      .orderBy(gstLedger.documentDate, gstLedger.documentNumber);
  }

  // RCM register — all purchase entries where the buyer self-assessed GST because the
  // supplier was unregistered (ES-10)
  static async getRcmRegister(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string // YYYY-MM
  ): Promise<typeof gstLedger.$inferSelect[]> {
    return db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.periodMonth, period),
          eq(gstLedger.rcmApplicable, true)
        )
      )
      .orderBy(gstLedger.documentDate, gstLedger.documentNumber);
  }

  // Aggregate summary for a period (used in GSTR-3B and dashboard)
  static async getSummary(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string
  ): Promise<{
    sales: { taxable: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
    // Ordinary (non-RCM) purchases only — RCM purchases are reported separately in `rcm`,
    // since RCM is a distinct output-tax liability line, not an ordinary ITC line (PG-039).
    purchases: { taxable: number; cgst: number; sgst: number; igst: number; cess: number; itcEligible: number };
    creditNotes: { taxable: number; cgst: number; sgst: number; igst: number };
    purchaseReturns: { taxable: number; cgst: number; sgst: number; igst: number };
    // Purchases the buyer self-assessed GST on because the supplier was unregistered.
    rcm: { taxable: number; cgst: number; sgst: number; igst: number; cess: number };
    // Purchases explicitly flagged itcEligible=false (blocked credits) — GSTR-3B Table 4B's
    // blocked-credit component. Does not include Rule 42/43 proportional exempt-ratio
    // reversal, which this system has no exempt-turnover-ratio calculation for (PG-039).
    ineligiblePurchases: { taxable: number; cgst: number; sgst: number; igst: number; cess: number };
  }> {
    const rows = await db.raw
      .select({
        entryType: gstLedger.entryType,
        itcEligible: gstLedger.itcEligible,
        rcmApplicable: gstLedger.rcmApplicable,
        taxableAmount: sql<string>`SUM(${gstLedger.taxableAmount})`,
        cgstAmount: sql<string>`SUM(${gstLedger.cgstAmount})`,
        sgstAmount: sql<string>`SUM(${gstLedger.sgstAmount})`,
        igstAmount: sql<string>`SUM(${gstLedger.igstAmount})`,
        cessAmount: sql<string>`SUM(${gstLedger.cessAmount})`,
        totalGst: sql<string>`SUM(${gstLedger.totalGst})`,
      })
      .from(gstLedger)
      .where(and(eq(gstLedger.tenantId, tenantId), eq(gstLedger.periodMonth, period)))
      .groupBy(gstLedger.entryType, gstLedger.itcEligible, gstLedger.rcmApplicable);

    const n = (v: string | null | undefined): number => Number(v ?? 0);
    type SummaryRow = (typeof rows)[number];
    type AmountCol = 'taxableAmount' | 'cgstAmount' | 'sgstAmount' | 'igstAmount' | 'cessAmount' | 'totalGst';

    const sum = (types: string[], col: AmountCol, extra?: (r: SummaryRow) => boolean): number =>
      rows
        .filter((r) => types.includes(r.entryType) && (extra ? extra(r) : true))
        .reduce((acc, r) => acc + n(r[col]), 0);

    const isOrdinaryPurchase = (r: SummaryRow): boolean => !r.rcmApplicable;
    const isRcmPurchase = (r: SummaryRow): boolean => !!r.rcmApplicable;

    return {
      sales: {
        taxable: sum(['SALES_INVOICE'], 'taxableAmount'),
        cgst: sum(['SALES_INVOICE'], 'cgstAmount'),
        sgst: sum(['SALES_INVOICE'], 'sgstAmount'),
        igst: sum(['SALES_INVOICE'], 'igstAmount'),
        cess: sum(['SALES_INVOICE'], 'cessAmount'),
        total: sum(['SALES_INVOICE'], 'totalGst'),
      },
      purchases: {
        taxable: sum(['PURCHASE'], 'taxableAmount', isOrdinaryPurchase),
        cgst: sum(['PURCHASE'], 'cgstAmount', isOrdinaryPurchase),
        sgst: sum(['PURCHASE'], 'sgstAmount', isOrdinaryPurchase),
        igst: sum(['PURCHASE'], 'igstAmount', isOrdinaryPurchase),
        cess: sum(['PURCHASE'], 'cessAmount', isOrdinaryPurchase),
        itcEligible:
          sum(['PURCHASE'], 'cgstAmount', (r) => isOrdinaryPurchase(r) && r.itcEligible) +
          sum(['PURCHASE'], 'sgstAmount', (r) => isOrdinaryPurchase(r) && r.itcEligible) +
          sum(['PURCHASE'], 'igstAmount', (r) => isOrdinaryPurchase(r) && r.itcEligible),
      },
      creditNotes: {
        taxable: sum(['CREDIT_NOTE'], 'taxableAmount'),
        cgst: sum(['CREDIT_NOTE'], 'cgstAmount'),
        sgst: sum(['CREDIT_NOTE'], 'sgstAmount'),
        igst: sum(['CREDIT_NOTE'], 'igstAmount'),
      },
      purchaseReturns: {
        taxable: sum(['PURCHASE_RETURN'], 'taxableAmount'),
        cgst: sum(['PURCHASE_RETURN'], 'cgstAmount'),
        sgst: sum(['PURCHASE_RETURN'], 'sgstAmount'),
        igst: sum(['PURCHASE_RETURN'], 'igstAmount'),
      },
      rcm: {
        taxable: sum(['PURCHASE'], 'taxableAmount', isRcmPurchase),
        cgst: sum(['PURCHASE'], 'cgstAmount', isRcmPurchase),
        sgst: sum(['PURCHASE'], 'sgstAmount', isRcmPurchase),
        igst: sum(['PURCHASE'], 'igstAmount', isRcmPurchase),
        cess: sum(['PURCHASE'], 'cessAmount', isRcmPurchase),
      },
      ineligiblePurchases: {
        taxable: sum(['PURCHASE'], 'taxableAmount', (r) => !r.itcEligible),
        cgst: sum(['PURCHASE'], 'cgstAmount', (r) => !r.itcEligible),
        sgst: sum(['PURCHASE'], 'sgstAmount', (r) => !r.itcEligible),
        igst: sum(['PURCHASE'], 'igstAmount', (r) => !r.itcEligible),
        cess: sum(['PURCHASE'], 'cessAmount', (r) => !r.itcEligible),
      },
    };
  }
}
