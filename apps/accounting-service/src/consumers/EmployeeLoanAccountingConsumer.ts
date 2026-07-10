import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface EmployeeLoanDisbursedPayload {
  employeeLoanId: number;
  employeeId: number;
  principalAmount: string | number;
  disbursedAmount: string | number;
}

export async function handleEmployeeLoanDisbursed(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as EmployeeLoanDisbursedPayload;
  const amount = Number(p.disbursedAmount ?? 0);

  if (amount <= 0) {
    logger.warn({ employeeLoanId: p.employeeLoanId }, 'Accounting: skipping EMPLOYEE_LOAN_DISBURSED journal — zero amount');
    return;
  }

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'EMPLOYEE_LOAN_DISBURSED',
      description: `Employee loan ${p.employeeLoanId} disbursed to employee ${p.employeeId}`,
      referenceType: 'EMPLOYEE_LOAN',
      referenceId: p.employeeLoanId,
      amount,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, employeeLoanId: p.employeeLoanId }, 'Accounting: EMPLOYEE_LOAN_DISBURSED posted');
  } catch (err) {
    logger.error({ err, employeeLoanId: p.employeeLoanId }, 'Accounting: failed to post EMPLOYEE_LOAN_DISBURSED');
    throw err;
  }
}
