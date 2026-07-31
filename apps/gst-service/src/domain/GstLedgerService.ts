import { eq, and, inArray, sql } from 'drizzle-orm';
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
        .where(
          and(eq(gstLedger.tenantId, tenantId), eq(gstLedger.sourceEventId, entry.sourceEventId))
        );

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

  // G6 fix: the GRN_APPROVED payload that creates an RCM purchase's ledger row
  // deliberately zeroes cgst/sgst/igst (apps/purchase-service/src/domain/GRNService.ts —
  // so accounting-service doesn't double-book a "GST payable to supplier" line for tax the
  // buyer self-assesses, not the supplier). The real self-assessed amount is carried
  // separately on RCM_LIABILITY_POSTED as a single lump sum (cgst+sgst+igst+cess combined —
  // this codebase's RCM accounting posting is a single liability line too, see
  // PostingMatrixService's RCM_LIABILITY_POSTED rule). This patches the already-inserted
  // row's tax columns using the row's own `isInterstate` flag to split the lump sum the same
  // way every other intrastate/interstate GST split in this codebase works (50/50 CGST/SGST,
  // or 100% IGST) — cess is left untouched (stays 0) since a combined lump sum can't be
  // reliably decomposed into a cess component without more data than this event carries.
  static async applyRcmLiability(
    db: TenantScopedDatabase,
    tenantId: number,
    grnId: number,
    rcmTaxAmount: number
  ): Promise<void> {
    const [row] = await db.raw
      .select({
        id: gstLedger.id,
        isInterstate: gstLedger.isInterstate,
        taxableAmount: gstLedger.taxableAmount,
        cessAmount: gstLedger.cessAmount,
      })
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.sourceDocumentType, 'GRN'),
          eq(gstLedger.sourceDocumentId, grnId)
        )
      );

    if (!row) {
      logger.warn(
        { grnId },
        'GST ledger: no row found for RCM_LIABILITY_POSTED (GRN_APPROVED not yet processed?)'
      );
      return;
    }

    const cessAmount = Number(row.cessAmount ?? 0);
    const cgstAmount = row.isInterstate ? 0 : rcmTaxAmount / 2;
    const sgstAmount = row.isInterstate ? 0 : rcmTaxAmount / 2;
    const igstAmount = row.isInterstate ? rcmTaxAmount : 0;
    const totalGst = cgstAmount + sgstAmount + igstAmount + cessAmount;
    const taxableAmount = Number(row.taxableAmount ?? 0);
    const gstRate = taxableAmount > 0 ? (rcmTaxAmount / taxableAmount) * 100 : 0;

    await db.raw
      .update(gstLedger)
      .set({
        cgstAmount: String(cgstAmount),
        sgstAmount: String(sgstAmount),
        igstAmount: String(igstAmount),
        totalGst: String(totalGst),
        grandTotal: String(taxableAmount + totalGst),
        gstRate: String(gstRate),
      })
      .where(eq(gstLedger.id, row.id));

    logger.info({ grnId, rcmTaxAmount }, 'GST ledger: RCM liability applied to purchase entry');
  }

  // C-2 fix: gst_ledger is append-only and had no reversal path at all — a cancelled invoice's
  // SALES_INVOICE row (written at confirm time) was never offset, so GSTR-1/3B outward-tax
  // figures permanently included every invoice that reached CONFIRMED before being cancelled.
  // Mirrors the reverse-by-lookup pattern JournalEngine.reverse already uses: read back the
  // original entry's own amounts/split rather than recomputing from the (GST-detail-free)
  // INVOICE_CANCELLED payload, and post an offsetting entry in the current period — the
  // original period may already be filed, so the reversal nets out going forward rather than
  // rewriting closed-period figures.
  static async reverseSalesInvoiceEntry(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number,
    cancelEventId: string
  ): Promise<number | null> {
    const [original] = await db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.sourceDocumentType, 'INVOICE'),
          eq(gstLedger.sourceDocumentId, invoiceId),
          eq(gstLedger.entryType, 'SALES_INVOICE')
        )
      )
      .orderBy(gstLedger.id)
      .limit(1);

    if (!original) {
      logger.warn(
        { invoiceId },
        'GST ledger: no SALES_INVOICE entry found for cancelled invoice — skipping reversal'
      );
      return null;
    }

    const now = new Date();
    const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const documentDate = now.toISOString().substring(0, 10);
    const neg = (v: string | null): string => String(-Number(v ?? 0));

    const id = await this.insertEntry(db, tenantId, {
      periodMonth,
      entryType: 'SALES_INVOICE',
      gstinOfCounterparty: original.gstinOfCounterparty,
      counterpartyName: original.counterpartyName,
      documentNumber: original.documentNumber,
      documentDate,
      placeOfSupply: original.placeOfSupply,
      isInterstate: original.isInterstate,
      taxableAmount: neg(original.taxableAmount),
      cgstAmount: neg(original.cgstAmount),
      sgstAmount: neg(original.sgstAmount),
      igstAmount: neg(original.igstAmount),
      cessAmount: neg(original.cessAmount),
      totalGst: neg(original.totalGst),
      grandTotal: neg(original.grandTotal),
      itcEligible: original.itcEligible,
      gstRate: original.gstRate,
      hsnCode: original.hsnCode,
      rcmApplicable: original.rcmApplicable,
      sourceEventId: cancelEventId,
      sourceDocumentId: invoiceId,
      sourceDocumentType: 'INVOICE',
      branchId: original.branchId,
    });

    logger.info(
      { invoiceId, reversalEntryId: id },
      'GST ledger: SALES_INVOICE entry reversed for cancelled invoice'
    );
    return id;
  }

  // List GST register entries for a period
  static async getRegister(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string, // YYYY-MM
    type: 'SALES' | 'PURCHASE' | 'ALL'
  ): Promise<(typeof gstLedger.$inferSelect)[]> {
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
  ): Promise<(typeof gstLedger.$inferSelect)[]> {
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
    sales: {
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
      cess: number;
      total: number;
    };
    // Ordinary (non-RCM) purchases only — RCM purchases are reported separately in `rcm`,
    // since RCM is a distinct output-tax liability line, not an ordinary ITC line (PG-039).
    purchases: {
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
      cess: number;
      itcEligible: number;
    };
    creditNotes: { taxable: number; cgst: number; sgst: number; igst: number };
    purchaseReturns: { taxable: number; cgst: number; sgst: number; igst: number };
    // Purchases the buyer self-assessed GST on because the supplier was unregistered.
    rcm: { taxable: number; cgst: number; sgst: number; igst: number; cess: number };
    // Purchases explicitly flagged itcEligible=false (blocked credits) — GSTR-3B Table 4B's
    // blocked-credit component. Does not include Rule 42/43 proportional exempt-ratio
    // reversal, which this system has no exempt-turnover-ratio calculation for (PG-039).
    ineligiblePurchases: {
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
      cess: number;
    };
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
    type AmountCol =
      'taxableAmount' | 'cgstAmount' | 'sgstAmount' | 'igstAmount' | 'cessAmount' | 'totalGst';

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
