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
}

export async function handleSaleReturnApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as SaleReturnApprovedPayload;
  const amount = Number(p.grandTotal ?? 0);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'SALE_RETURN_APPROVED',
      description: `Sale return ${p.returnNumber ?? p.returnId} approved`,
      referenceType: 'SALE_RETURN',
      referenceId: p.returnId,
      amount,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, returnId: p.returnId }, 'Accounting: SALE_RETURN_APPROVED posted');
  } catch (err) {
    logger.error({ err, returnId: p.returnId }, 'Accounting: failed to post SALE_RETURN_APPROVED');
    throw err;
  }
}
