import { eq, and } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { gst2aEntries, gstLedger } from '@erp/db';
import { createLogger } from '@erp/logger';
import { ValidationError } from '@erp/types';

const logger = createLogger({ serviceName: 'gst-service' });

// ±1% tolerance for amount matching
const MATCH_TOLERANCE_PCT = 0.01;

export interface Gstr2aRow {
  supplierGstin: string;
  supplierName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount?: number;
  placeOfSupply?: string;
}

export interface Gstr2aImportResult {
  imported: number;
  duplicatesSkipped: number;
  batchId: string;
}

export interface ReconciliationSummary {
  period: string;
  matched: number;
  booksOnly: number;
  gstr2aOnly: number;
  amountMismatch: number;
  matchedTaxableAmount: number;
  booksOnlyTaxableAmount: number;
  gstr2aOnlyTaxableAmount: number;
  amountMismatchVariance: number;
}

export class Gstr2aService {
  // Import GSTR-2A data (uploaded by accountant as JSON from portal)
  static async importGstr2a(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string,
    rows: Gstr2aRow[]
  ): Promise<Gstr2aImportResult> {
    if (!rows.length) throw new ValidationError('GSTR-2A import: no rows provided');

    const batchId = `2A-${period}-${Date.now()}`;
    let imported = 0;
    let duplicatesSkipped = 0;

    for (const row of rows) {
      // Check for duplicate (same supplier GSTIN + invoice number + period)
      const [existing] = await db.raw
        .select({ id: gst2aEntries.id })
        .from(gst2aEntries)
        .where(
          and(
            eq(gst2aEntries.tenantId, tenantId),
            eq(gst2aEntries.period, period),
            eq(gst2aEntries.supplierGstin, row.supplierGstin),
            eq(gst2aEntries.invoiceNumber, row.invoiceNumber)
          )
        );

      if (existing) {
        duplicatesSkipped++;
        continue;
      }

      await db.raw.insert(gst2aEntries).values({
        tenantId,
        period,
        importBatchId: batchId,
        supplierGstin: row.supplierGstin,
        supplierName: row.supplierName ?? null,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate,
        taxableAmount: String(row.taxableAmount),
        cgstAmount: String(row.cgstAmount),
        sgstAmount: String(row.sgstAmount),
        igstAmount: String(row.igstAmount),
        cessAmount: String(row.cessAmount ?? 0),
        placeOfSupply: row.placeOfSupply ?? null,
        reconciliationStatus: 'UNMATCHED',
      });

      imported++;
    }

    logger.info({ tenantId, period, imported, duplicatesSkipped, batchId }, 'GSTR-2A imported');

    // Auto-reconcile after import
    await Gstr2aService.reconcile(db, tenantId, period);

    return { imported, duplicatesSkipped, batchId };
  }

  // Reconcile GSTR-2A entries against purchase ledger entries
  static async reconcile(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string
  ): Promise<void> {
    const gstr2aRows = await db.raw
      .select()
      .from(gst2aEntries)
      .where(and(eq(gst2aEntries.tenantId, tenantId), eq(gst2aEntries.period, period)));

    const ledgerRows = await db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.periodMonth, period),
          eq(gstLedger.entryType, 'PURCHASE')
        )
      );

    const n = (v: unknown): number => Number(v ?? 0);

    for (const gstr2aRow of gstr2aRows) {
      // Find a matching ledger entry by supplier GSTIN + invoice number
      const ledgerMatch = ledgerRows.find(
        (l) =>
          l.gstinOfCounterparty === gstr2aRow.supplierGstin &&
          normalizeInvoiceNumber(l.documentNumber) === normalizeInvoiceNumber(gstr2aRow.invoiceNumber)
      );

      if (!ledgerMatch) {
        await db.raw
          .update(gst2aEntries)
          .set({ reconciliationStatus: 'GSTR2A_ONLY', reconciledAt: new Date() })
          .where(eq(gst2aEntries.id, gstr2aRow.id));
        continue;
      }

      const taxableGstr2a = n(gstr2aRow.taxableAmount);
      const taxableLedger = n(ledgerMatch.taxableAmount);
      const tolerance = taxableGstr2a * MATCH_TOLERANCE_PCT;
      const variance = Math.abs(taxableGstr2a - taxableLedger);

      if (variance <= tolerance) {
        await db.raw
          .update(gst2aEntries)
          .set({
            reconciliationStatus: 'MATCHED',
            matchedLedgerId: ledgerMatch.id,
            matchVariance: String(variance),
            reconciledAt: new Date(),
          })
          .where(eq(gst2aEntries.id, gstr2aRow.id));
      } else {
        await db.raw
          .update(gst2aEntries)
          .set({
            reconciliationStatus: 'AMOUNT_MISMATCH',
            matchedLedgerId: ledgerMatch.id,
            matchVariance: String(variance),
            reconciledAt: new Date(),
          })
          .where(eq(gst2aEntries.id, gstr2aRow.id));
      }
    }

    // Mark BOOKS_ONLY: purchase ledger entries not present in GSTR-2A
    for (const ledgerRow of ledgerRows) {
      if (!ledgerRow.gstinOfCounterparty) continue;
      const gstr2aMatch = gstr2aRows.find(
        (g) =>
          g.supplierGstin === ledgerRow.gstinOfCounterparty &&
          normalizeInvoiceNumber(g.invoiceNumber) === normalizeInvoiceNumber(ledgerRow.documentNumber)
      );
      if (!gstr2aMatch) {
        // Books-only: the supplier hasn't filed GSTR-1 yet
        logger.debug({ documentNumber: ledgerRow.documentNumber }, 'GSTR-2A reconcile: BOOKS_ONLY entry');
      }
    }

    logger.info({ tenantId, period }, 'GSTR-2A reconciliation complete');
  }

  static async getReconciliation(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string
  ): Promise<{
    gstr2aEntries: typeof gst2aEntries.$inferSelect[];
    booksOnlyEntries: typeof gstLedger.$inferSelect[];
    summary: ReconciliationSummary;
  }> {
    const gstr2aRows = await db.raw
      .select()
      .from(gst2aEntries)
      .where(and(eq(gst2aEntries.tenantId, tenantId), eq(gst2aEntries.period, period)));

    const ledgerRows = await db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.periodMonth, period),
          eq(gstLedger.entryType, 'PURCHASE')
        )
      );

    const n = (v: unknown): number => Number(v ?? 0);

    // Books-only: purchase ledger entries not in GSTR-2A
    const matchedInvoiceNumbers = new Set(
      gstr2aRows
        .filter((r) => r.reconciliationStatus === 'MATCHED' || r.reconciliationStatus === 'AMOUNT_MISMATCH')
        .map((r) => normalizeInvoiceNumber(r.invoiceNumber))
    );
    const booksOnlyEntries = ledgerRows.filter(
      (l) => l.gstinOfCounterparty && !matchedInvoiceNumbers.has(normalizeInvoiceNumber(l.documentNumber))
    );

    const matched = gstr2aRows.filter((r) => r.reconciliationStatus === 'MATCHED').length;
    const amountMismatch = gstr2aRows.filter((r) => r.reconciliationStatus === 'AMOUNT_MISMATCH').length;
    const gstr2aOnly = gstr2aRows.filter((r) => r.reconciliationStatus === 'GSTR2A_ONLY').length;

    const summary: ReconciliationSummary = {
      period,
      matched,
      booksOnly: booksOnlyEntries.length,
      gstr2aOnly,
      amountMismatch,
      matchedTaxableAmount: gstr2aRows.filter((r) => r.reconciliationStatus === 'MATCHED').reduce((s, r) => s + n(r.taxableAmount), 0),
      booksOnlyTaxableAmount: booksOnlyEntries.reduce((s, r) => s + n(r.taxableAmount), 0),
      gstr2aOnlyTaxableAmount: gstr2aRows.filter((r) => r.reconciliationStatus === 'GSTR2A_ONLY').reduce((s, r) => s + n(r.taxableAmount), 0),
      amountMismatchVariance: gstr2aRows.filter((r) => r.reconciliationStatus === 'AMOUNT_MISMATCH').reduce((s, r) => s + n(r.matchVariance), 0),
    };

    return { gstr2aEntries: gstr2aRows, booksOnlyEntries, summary };
  }
}

function normalizeInvoiceNumber(num: string): string {
  return num.trim().toUpperCase().replace(/\s+/g, '');
}
