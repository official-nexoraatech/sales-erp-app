import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface PurchaseReturnApprovedPayload {
  returnId: number;
  returnNumber?: string;
  supplierId?: number;
  grandTotal: string | number;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  isInterstate?: boolean;
}

export async function handlePurchaseReturnApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PurchaseReturnApprovedPayload;

  const grandTotal = Number(p.grandTotal ?? 0);
  const taxableAmount = Number(p.taxableAmount ?? grandTotal);
  const cgstAmount = Number(p.cgstAmount ?? 0);
  const sgstAmount = Number(p.sgstAmount ?? 0);
  const igstAmount = Number(p.igstAmount ?? 0);

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'PURCHASE_RETURN_APPROVED',
      description: `Purchase return ${p.returnNumber ?? p.returnId} approved — goods returned to supplier`,
      referenceType: 'PURCHASE_RETURN',
      referenceId: p.returnId,
      amount: grandTotal,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      ...(p.isInterstate !== undefined ? { isInterstate: p.isInterstate } : {}),
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, returnId: p.returnId },
      'Accounting: PURCHASE_RETURN_APPROVED posted'
    );
  } catch (err) {
    logger.error(
      { err, returnId: p.returnId },
      'Accounting: failed to post PURCHASE_RETURN_APPROVED'
    );
    throw err;
  }
}
