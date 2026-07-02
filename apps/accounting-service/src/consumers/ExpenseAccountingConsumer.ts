import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface ExpensePayload {
  expenseId: number;
  expenseNumber?: string;
  grandTotal: string | number;
  category?: string;
}

export async function handleExpenseApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as ExpensePayload;
  const amount = Number(p.grandTotal ?? 0);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'EXPENSE_APPROVED',
      description: `Expense ${p.expenseNumber ?? p.expenseId} approved`,
      referenceType: 'EXPENSE',
      referenceId: p.expenseId,
      amount,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, expenseId: p.expenseId }, 'Accounting: EXPENSE_APPROVED posted');
  } catch (err) {
    logger.error({ err, expenseId: p.expenseId }, 'Accounting: failed to post EXPENSE_APPROVED');
    throw err;
  }
}

export async function handleExpensePaid(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as ExpensePayload;
  const amount = Number(p.grandTotal ?? 0);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'EXPENSE_PAID',
      description: `Expense ${p.expenseNumber ?? p.expenseId} paid`,
      referenceType: 'EXPENSE',
      referenceId: p.expenseId,
      amount,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, expenseId: p.expenseId }, 'Accounting: EXPENSE_PAID posted');
  } catch (err) {
    logger.error({ err, expenseId: p.expenseId }, 'Accounting: failed to post EXPENSE_PAID');
    throw err;
  }
}
