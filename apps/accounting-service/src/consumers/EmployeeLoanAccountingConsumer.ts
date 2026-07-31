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

interface EmployeeLoanRepaidPayload {
  payrollRunId: number;
  totalAmount: string | number;
}

export async function handleEmployeeLoanDisbursed(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as EmployeeLoanDisbursedPayload;
  const amount = Number(p.disbursedAmount ?? 0);

  if (amount <= 0) {
    logger.warn(
      { employeeLoanId: p.employeeLoanId },
      'Accounting: skipping EMPLOYEE_LOAN_DISBURSED journal — zero amount'
    );
    return;
  }

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'EMPLOYEE_LOAN_DISBURSED',
      description: `Employee loan ${p.employeeLoanId} disbursed to employee ${p.employeeId}`,
      referenceType: 'EMPLOYEE_LOAN',
      referenceId: p.employeeLoanId,
      amount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, employeeLoanId: p.employeeLoanId },
      'Accounting: EMPLOYEE_LOAN_DISBURSED posted'
    );
  } catch (err) {
    logger.error(
      { err, employeeLoanId: p.employeeLoanId },
      'Accounting: failed to post EMPLOYEE_LOAN_DISBURSED'
    );
    throw err;
  }
}

// Audit finding 2026-07-23: hr-service decrements each loan's outstandingBalance on payroll
// approval (EmployeeLoanService.applyMonthlyDeduction) but previously emitted no event for it —
// Employee Loans Receivable (1340) was debited once at disbursement and never credited down,
// permanently overstated relative to the real outstanding balance. Additive journal alongside
// PAYROLL_RUN_APPROVED, same pattern as COGS_CALCULATED alongside INVOICE_CONFIRMED.
export async function handleEmployeeLoanRepaid(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as EmployeeLoanRepaidPayload;
  const amount = Number(p.totalAmount ?? 0);

  if (amount <= 0) {
    logger.warn(
      { payrollRunId: p.payrollRunId },
      'Accounting: skipping EMPLOYEE_LOAN_REPAID journal — zero amount'
    );
    return;
  }

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'EMPLOYEE_LOAN_REPAID',
      description: `Employee loan EMI recovered via payroll run ${p.payrollRunId}`,
      referenceType: 'PAYROLL_RUN',
      referenceId: p.payrollRunId,
      amount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, payrollRunId: p.payrollRunId },
      'Accounting: EMPLOYEE_LOAN_REPAID posted'
    );
  } catch (err) {
    logger.error(
      { err, payrollRunId: p.payrollRunId },
      'Accounting: failed to post EMPLOYEE_LOAN_REPAID'
    );
    throw err;
  }
}
