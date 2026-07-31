import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface StockAdjustmentPostedPayload {
  adjustmentId: number;
  adjustmentNumber?: string;
  adjustmentType?: string;
  warehouseId?: number;
  netValue: string | number;
  direction: 'LOSS' | 'GAIN';
}

export async function handleStockAdjustmentPosted(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as StockAdjustmentPostedPayload;
  const amount = Number(p.netValue ?? 0);
  if (amount <= 0) {
    logger.warn(
      { adjustmentId: p.adjustmentId },
      'Accounting: skipping STOCK_ADJUSTMENT_POSTED journal — zero/missing netValue'
    );
    return;
  }

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: p.direction === 'LOSS' ? 'STOCK_ADJUSTMENT_LOSS' : 'STOCK_ADJUSTMENT_GAIN',
      description: `Stock adjustment ${p.adjustmentNumber ?? p.adjustmentId} (${p.adjustmentType ?? 'ADJUSTMENT'}) — ${p.direction === 'LOSS' ? 'stock write-off' : 'excess stock found'}`,
      referenceType: 'STOCK_ADJUSTMENT',
      referenceId: p.adjustmentId,
      amount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, adjustmentId: p.adjustmentId, direction: p.direction },
      'Accounting: STOCK_ADJUSTMENT_POSTED posted'
    );
  } catch (err) {
    logger.error(
      { err, adjustmentId: p.adjustmentId },
      'Accounting: failed to post STOCK_ADJUSTMENT_POSTED'
    );
    throw err;
  }
}
