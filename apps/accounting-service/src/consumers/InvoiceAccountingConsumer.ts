import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface InvoiceConfirmedPayload {
  invoiceId: number;
  invoiceNumber: string;
  customerId?: number;
  grandTotal: string | number;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  placeOfSupply?: string;
  isInterstate?: boolean;
}

interface InvoiceCancelledPayload {
  invoiceId: number;
  invoiceNumber: string;
  originalJournalId?: string;
}

export async function handleInvoiceConfirmed(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as InvoiceConfirmedPayload;

  const grandTotal = Number(p.grandTotal ?? 0);
  const taxableAmount = Number(p.taxableAmount ?? grandTotal);
  const cgstAmount = Number(p.cgstAmount ?? 0);
  const sgstAmount = Number(p.sgstAmount ?? 0);
  const igstAmount = Number(p.igstAmount ?? 0);
  // The producer (InvoiceService.confirm) already computes this correctly from
  // igstAmount > 0 — recomputing it here from placeOfSupply/sellerStateCode was wrong: the
  // producer never sends sellerStateCode, so that comparison was `true` for every invoice,
  // which meant the CGST/SGST posting branch never fired and tax lines were silently
  // dropped from every invoice-confirmation journal (found in live QA 2026-07-17).
  const isInterstate = p.isInterstate ?? false;

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'INVOICE_CONFIRMED',
      description: `Invoice ${p.invoiceNumber} confirmed`,
      referenceType: 'INVOICE',
      referenceId: p.invoiceId,
      amount: grandTotal,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      isInterstate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, invoiceId: p.invoiceId },
      'Accounting: INVOICE_CONFIRMED posted'
    );
  } catch (err) {
    logger.error({ err, invoiceId: p.invoiceId }, 'Accounting: failed to post INVOICE_CONFIRMED');
    throw err;
  }
}

export async function handleInvoiceCancelled(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as InvoiceCancelledPayload;

  try {
    // Find the original journal for this invoice
    const [original] = (await db.raw.execute(
      `SELECT journal_id FROM journals
       WHERE tenant_id = ${event.tenantId}
         AND reference_type = 'INVOICE'
         AND reference_id = ${p.invoiceId}
         AND is_reversal = false
         AND status = 'POSTED'
       LIMIT 1`
    )) as { journal_id: string }[];

    if (!original?.journal_id) {
      logger.warn(
        { invoiceId: p.invoiceId },
        'Accounting: no posted journal found for cancelled invoice — skipping reversal'
      );
      return;
    }

    const result = await JournalEngine.reverse(
      db,
      event.tenantId,
      event.userId,
      original.journal_id,
      `Reversal: Invoice ${p.invoiceNumber} cancelled`
    );
    logger.info(
      { journalId: result.journalId, invoiceId: p.invoiceId },
      'Accounting: INVOICE_CANCELLED reversed'
    );
  } catch (err) {
    logger.error(
      { err, invoiceId: p.invoiceId },
      'Accounting: failed to reverse INVOICE_CANCELLED'
    );
    throw err;
  }
}
