import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { GstLedgerService } from '../domain/GstLedgerService.js';

const logger = createLogger({ serviceName: 'gst-service' });

interface GRNApprovedPayload {
  grnId: number;
  grnNumber: string;
  grnDate?: string;
  supplierId?: number;
  supplierName?: string;
  supplierGstin?: string;
  placeOfSupply?: string;
  sellerStateCode?: string;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  cessAmount?: string | number;
  grandTotal?: string | number;
  gstRate?: string | number;
  itcEligible?: boolean;
  itcReversalReason?: string;
  rcmApplicable?: boolean;
  branchId?: number;
}

interface PurchaseReturnApprovedPayload {
  returnId: number;
  returnNumber: string;
  returnDate?: string;
  supplierId?: number;
  supplierName?: string;
  supplierGstin?: string;
  placeOfSupply?: string;
  sellerStateCode?: string;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  cessAmount?: string | number;
  grandTotal?: string | number;
}

export async function handleGRNApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as GRNApprovedPayload;
  const n = (v: unknown): number => Number(v ?? 0);

  const taxableAmount = n(p.taxableAmount);
  const cgstAmount = n(p.cgstAmount);
  const sgstAmount = n(p.sgstAmount);
  const igstAmount = n(p.igstAmount);
  const cessAmount = n(p.cessAmount);
  const totalGst = cgstAmount + sgstAmount + igstAmount + cessAmount;
  const grandTotal = n(p.grandTotal) || taxableAmount + totalGst;

  const isInterstate = !!(
    p.sellerStateCode &&
    p.placeOfSupply &&
    p.sellerStateCode !== p.placeOfSupply
  );
  const documentDate = p.grnDate
    ? p.grnDate.substring(0, 10)
    : new Date().toISOString().substring(0, 10);
  const periodMonth = documentDate.substring(0, 7);
  // Same gstRate-never-populated gap as InvoiceGstConsumer — derive from actual tax charged.
  const derivedGstRate =
    p.gstRate ?? (taxableAmount > 0 ? ((totalGst - cessAmount) / taxableAmount) * 100 : 0);

  try {
    await GstLedgerService.insertEntry(db, event.tenantId, {
      periodMonth,
      entryType: 'PURCHASE',
      gstinOfCounterparty: p.supplierGstin ?? null,
      counterpartyName: p.supplierName ?? null,
      documentNumber: p.grnNumber,
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
      // ITC eligibility: default true unless supplier hasn't filed or item is blocked
      itcEligible: p.itcEligible !== false,
      itcReversalReason: p.itcReversalReason ?? null,
      gstRate: String(derivedGstRate),
      rcmApplicable: p.rcmApplicable ?? false,
      sourceEventId: event.eventId,
      sourceDocumentId: p.grnId,
      sourceDocumentType: 'GRN',
      branchId: p.branchId ?? null,
    });

    logger.info({ grnId: p.grnId, periodMonth }, 'GST ledger: GRN_APPROVED purchase recorded');
  } catch (err) {
    logger.error({ err, grnId: p.grnId }, 'GST ledger: failed to record GRN_APPROVED');
    throw err;
  }
}

export async function handlePurchaseReturnApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PurchaseReturnApprovedPayload;
  const n = (v: unknown): number => Number(v ?? 0);

  const taxableAmount = n(p.taxableAmount);
  const cgstAmount = n(p.cgstAmount);
  const sgstAmount = n(p.sgstAmount);
  const igstAmount = n(p.igstAmount);
  const cessAmount = n(p.cessAmount);
  const totalGst = cgstAmount + sgstAmount + igstAmount + cessAmount;
  const grandTotal = n(p.grandTotal) || taxableAmount + totalGst;

  const isInterstate = !!(
    p.sellerStateCode &&
    p.placeOfSupply &&
    p.sellerStateCode !== p.placeOfSupply
  );
  const documentDate = p.returnDate
    ? p.returnDate.substring(0, 10)
    : new Date().toISOString().substring(0, 10);
  const periodMonth = documentDate.substring(0, 7);
  const derivedGstRate = taxableAmount > 0 ? ((totalGst - cessAmount) / taxableAmount) * 100 : 0;

  try {
    await GstLedgerService.insertEntry(db, event.tenantId, {
      periodMonth,
      entryType: 'PURCHASE_RETURN',
      gstinOfCounterparty: p.supplierGstin ?? null,
      counterpartyName: p.supplierName ?? null,
      documentNumber: p.returnNumber,
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
      gstRate: String(derivedGstRate),
      sourceEventId: event.eventId,
      sourceDocumentId: p.returnId,
      sourceDocumentType: 'PURCHASE_RETURN',
    });

    logger.info({ returnId: p.returnId }, 'GST ledger: PURCHASE_RETURN_APPROVED recorded');
  } catch (err) {
    logger.error(
      { err, returnId: p.returnId },
      'GST ledger: failed to record PURCHASE_RETURN_APPROVED'
    );
    throw err;
  }
}

interface RcmLiabilityPostedPayload {
  grnId: number;
  grnNumber: string;
  supplierId: number;
  rcmTaxAmount: string | number;
}

// G6 fix: the GRN_APPROVED handler above always records ₹0 cgst/sgst/igst for RCM purchases
// (the shared event payload deliberately zeroes them for accounting-service's benefit — see
// GstLedgerService.applyRcmLiability's comment). This is the real self-assessed tax amount,
// applied as a follow-up patch to the row handleGRNApproved already inserted.
export async function handleRcmLiabilityPosted(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as RcmLiabilityPostedPayload;
  const rcmTaxAmount = Number(p.rcmTaxAmount ?? 0);
  if (rcmTaxAmount <= 0) return;

  try {
    await GstLedgerService.applyRcmLiability(db, event.tenantId, p.grnId, rcmTaxAmount);
  } catch (err) {
    logger.error({ err, grnId: p.grnId }, 'GST ledger: failed to apply RCM_LIABILITY_POSTED');
    throw err;
  }
}
