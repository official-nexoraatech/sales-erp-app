import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface CommissionApprovedPayload {
  commissionId: number;
  invoiceId: number;
  earnedByUserId: number;
  amount: string | number;
}

export async function handleCommissionApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as CommissionApprovedPayload;
  const amount = Number(p.amount ?? 0);
  if (amount <= 0) {
    logger.warn(
      { commissionId: p.commissionId },
      'Accounting: skipping COMMISSION_APPROVED journal — zero/missing amount'
    );
    return;
  }

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'COMMISSION_APPROVED',
      description: `Sales commission approved — invoice ${p.invoiceId}, rep ${p.earnedByUserId}`,
      referenceType: 'COMMISSION',
      referenceId: p.commissionId,
      amount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, commissionId: p.commissionId },
      'Accounting: COMMISSION_APPROVED posted'
    );
  } catch (err) {
    logger.error(
      { err, commissionId: p.commissionId },
      'Accounting: failed to post COMMISSION_APPROVED'
    );
    throw err;
  }
}
