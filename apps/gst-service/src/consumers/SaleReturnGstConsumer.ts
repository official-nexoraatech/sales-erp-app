import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { GstLedgerService } from '../domain/GstLedgerService.js';

const logger = createLogger({ serviceName: 'gst-service' });

interface SaleReturnApprovedPayload {
  returnId: number;
  creditNoteNumber: string;
  creditNoteDate?: string;
  originalInvoiceId?: number;
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
}

export async function handleSaleReturnApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as SaleReturnApprovedPayload;
  const n = (v: unknown): number => Number(v ?? 0);

  const taxableAmount = n(p.taxableAmount);
  const cgstAmount = n(p.cgstAmount);
  const sgstAmount = n(p.sgstAmount);
  const igstAmount = n(p.igstAmount);
  const cessAmount = n(p.cessAmount);
  const totalGst = cgstAmount + sgstAmount + igstAmount + cessAmount;
  const grandTotal = n(p.grandTotal) || taxableAmount + totalGst;

  const isInterstate = p.sellerStateCode !== p.placeOfSupply;
  const documentDate = p.creditNoteDate ? p.creditNoteDate.substring(0, 10) : new Date().toISOString().substring(0, 10);
  const periodMonth = documentDate.substring(0, 7);

  try {
    await GstLedgerService.insertEntry(db, event.tenantId, {
      periodMonth,
      entryType: 'CREDIT_NOTE',
      gstinOfCounterparty: p.customerGstin ?? null,
      counterpartyName: p.customerName ?? null,
      documentNumber: p.creditNoteNumber,
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
      rcmApplicable: false,
      sourceEventId: event.eventId,
      sourceDocumentId: p.returnId,
      sourceDocumentType: 'SALE_RETURN',
      branchId: p.branchId ?? null,
    });

    logger.info({ returnId: p.returnId, creditNoteNumber: p.creditNoteNumber }, 'GST ledger: SALE_RETURN credit note recorded');
  } catch (err) {
    logger.error({ err, returnId: p.returnId }, 'GST ledger: failed to record SALE_RETURN_APPROVED');
    throw err;
  }
}
