import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface PayrollRunApprovedPayload {
  payrollRunId: number;
  periodMonth: number;
  periodYear: number;
  totalGross: string | number;
  totalDeductions: string | number;
  totalNet: string | number;
}

interface PayrollRunDisbursedPayload {
  payrollRunId: number;
  totalNet: string | number;
}

export async function handlePayrollRunApproved(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PayrollRunApprovedPayload;
  const totalNet = Number(p.totalNet ?? 0);

  if (totalNet <= 0) {
    logger.warn({ payrollRunId: p.payrollRunId }, 'Accounting: skipping PAYROLL_RUN_APPROVED journal — zero net amount');
    return;
  }

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'PAYROLL_RUN_APPROVED',
      description: `Payroll ${p.periodMonth}/${p.periodYear} approved — salary expense accrual`,
      referenceType: 'PAYROLL_RUN',
      referenceId: p.payrollRunId,
      amount: totalNet,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, payrollRunId: p.payrollRunId }, 'Accounting: PAYROLL_RUN_APPROVED posted');
  } catch (err) {
    logger.error({ err, payrollRunId: p.payrollRunId }, 'Accounting: failed to post PAYROLL_RUN_APPROVED');
    throw err;
  }
}

export async function handlePayrollRunDisbursed(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PayrollRunDisbursedPayload;
  const totalNet = Number(p.totalNet ?? 0);

  if (totalNet <= 0) {
    logger.warn({ payrollRunId: p.payrollRunId }, 'Accounting: skipping PAYROLL_RUN_DISBURSED journal — zero net amount');
    return;
  }

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'PAYROLL_RUN_DISBURSED',
      description: `Payroll run ${p.payrollRunId} disbursed`,
      referenceType: 'PAYROLL_RUN',
      referenceId: p.payrollRunId,
      amount: totalNet,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, payrollRunId: p.payrollRunId }, 'Accounting: PAYROLL_RUN_DISBURSED posted');
  } catch (err) {
    logger.error({ err, payrollRunId: p.payrollRunId }, 'Accounting: failed to post PAYROLL_RUN_DISBURSED');
    throw err;
  }
}
