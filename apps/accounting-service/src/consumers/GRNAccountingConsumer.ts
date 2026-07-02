import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface GRNApprovedPayload {
  grnId: number;
  grnNumber: string;
  supplierId: number;
  grandTotal: string | number;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  isInterstate?: boolean;
  warehouseId: number;
}

export async function handleGRNApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as GRNApprovedPayload;

  const grandTotal = Number(p.grandTotal ?? 0);
  const taxableAmount = Number(p.taxableAmount ?? grandTotal);
  const cgstAmount = Number(p.cgstAmount ?? 0);
  const sgstAmount = Number(p.sgstAmount ?? 0);
  const igstAmount = Number(p.igstAmount ?? 0);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'GRN_APPROVED',
      description: `GRN ${p.grnNumber} approved — inventory received`,
      referenceType: 'GRN',
      referenceId: p.grnId,
      amount: grandTotal,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      ...(p.isInterstate !== undefined ? { isInterstate: p.isInterstate } : {}),
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, grnId: p.grnId }, 'Accounting: GRN_APPROVED posted');
  } catch (err) {
    logger.error({ err, grnId: p.grnId }, 'Accounting: failed to post GRN_APPROVED');
    throw err;
  }
}
