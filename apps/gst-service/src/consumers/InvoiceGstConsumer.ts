import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { GstLedgerService } from '../domain/GstLedgerService.js';

const logger = createLogger({ serviceName: 'gst-service' });

interface InvoiceConfirmedPayload {
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate?: string;
  customerId?: number;
  customerName?: string;
  customerGstin?: string;
  placeOfSupply?: string;
  sellerStateCode?: string;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  cessAmount?: string | number;
  grandTotal?: string | number;
  gstRate?: string | number;
  hsnCode?: string;
  branchId?: number;
  rcmApplicable?: boolean;
}

export async function handleInvoiceConfirmed(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as InvoiceConfirmedPayload;
  const n = (v: unknown): number => Number(v ?? 0);

  const taxableAmount = n(p.taxableAmount);
  const cgstAmount = n(p.cgstAmount);
  const sgstAmount = n(p.sgstAmount);
  const igstAmount = n(p.igstAmount);
  const cessAmount = n(p.cessAmount);
  const totalGst = cgstAmount + sgstAmount + igstAmount + cessAmount;
  const grandTotal = n(p.grandTotal) || taxableAmount + totalGst;

  const isInterstate = p.sellerStateCode !== p.placeOfSupply;

  // Period = YYYY-MM from invoiceDate or event createdAt
  const documentDate = p.invoiceDate ? p.invoiceDate.substring(0, 10) : new Date().toISOString().substring(0, 10);
  const periodMonth = documentDate.substring(0, 7);

  try {
    await GstLedgerService.insertEntry(db, event.tenantId, {
      periodMonth,
      entryType: 'SALES_INVOICE',
      gstinOfCounterparty: p.customerGstin ?? null,
      counterpartyName: p.customerName ?? null,
      documentNumber: p.invoiceNumber,
      documentDate,
      placeOfSupply: p.placeOfSupply ?? null,
      isInterstate,
      taxableAmount: String(taxableAmount),
      cgstAmount: String(cgstAmount),
      sgstAmount: String(sgstAmount),
      igstAmount: String(igstAmount),
      cessAmount: String(cessAmount),
      totalGst: String(totalGst),
      grandTotal: String(grandTotal),
      itcEligible: false,
      gstRate: p.gstRate ? String(p.gstRate) : null,
      hsnCode: p.hsnCode ?? null,
      rcmApplicable: p.rcmApplicable ?? false,
      sourceEventId: event.eventId,
      sourceDocumentId: p.invoiceId,
      sourceDocumentType: 'INVOICE',
      branchId: p.branchId ?? null,
    });

    logger.info({ invoiceId: p.invoiceId, periodMonth }, 'GST ledger: INVOICE_CONFIRMED recorded');
  } catch (err) {
    logger.error({ err, invoiceId: p.invoiceId }, 'GST ledger: failed to record INVOICE_CONFIRMED');
    throw err;
  }
}
