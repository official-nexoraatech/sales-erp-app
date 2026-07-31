import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface RcmLiabilityPostedPayload {
  grnId: number;
  grnNumber: string;
  supplierId: number;
  rcmTaxAmount: string | number;
}

export async function handleRcmLiabilityPosted(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as RcmLiabilityPostedPayload;
  const rcmTaxAmount = Number(p.rcmTaxAmount ?? 0);

  if (rcmTaxAmount <= 0) {
    logger.warn(
      { grnId: p.grnId },
      'Accounting: skipping RCM_LIABILITY_POSTED journal — zero/missing rcmTaxAmount'
    );
    return;
  }

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'RCM_LIABILITY_POSTED',
      description: `GRN ${p.grnNumber} — RCM liability (unregistered vendor)`,
      referenceType: 'GRN',
      referenceId: p.grnId,
      amount: rcmTaxAmount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, grnId: p.grnId },
      'Accounting: RCM_LIABILITY_POSTED posted'
    );
  } catch (err) {
    logger.error({ err, grnId: p.grnId }, 'Accounting: failed to post RCM_LIABILITY_POSTED');
    throw err;
  }
}
