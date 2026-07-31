import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface SaleReturnApprovedPayload {
  returnId: number;
  returnNumber?: string;
  customerId?: number;
  grandTotal: string | number;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  isInterstate?: boolean;
}

export async function handleSaleReturnApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as SaleReturnApprovedPayload;
  const amount = Number(p.grandTotal ?? 0);
  const taxableAmount = Number(p.taxableAmount ?? amount);
  const cgstAmount = Number(p.cgstAmount ?? 0);
  const sgstAmount = Number(p.sgstAmount ?? 0);
  const igstAmount = Number(p.igstAmount ?? 0);
  const isInterstate = p.isInterstate ?? false;

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    // C-3 fix: previously only `amount` (grandTotal) was passed, so the full tax-inclusive
    // return amount booked entirely against Sales-Returns/AR — CGST/SGST/IGST Payable were
    // never credited down, permanently overstating GST-payable liability on every sale
    // return. The GST breakdown has been on this event's payload since d9d657e; it just
    // wasn't forwarded to the posting matrix.
    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'SALE_RETURN_APPROVED',
      description: `Sale return ${p.returnNumber ?? p.returnId} approved`,
      referenceType: 'SALE_RETURN',
      referenceId: p.returnId,
      amount,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      isInterstate,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, returnId: p.returnId },
      'Accounting: SALE_RETURN_APPROVED posted'
    );
  } catch (err) {
    logger.error({ err, returnId: p.returnId }, 'Accounting: failed to post SALE_RETURN_APPROVED');
    throw err;
  }
}
