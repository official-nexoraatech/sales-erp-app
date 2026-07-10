import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPeriodOpen = vi.fn().mockResolvedValue(undefined);
const postJournal = vi.fn().mockResolvedValue({ journalId: 'J1', linesPosted: 2 });
const buildJournalEntry = vi.fn().mockResolvedValue({
  description: 'Employee loan disbursed',
  referenceType: 'EMPLOYEE_LOAN',
  referenceId: 1,
  lines: [
    { accountId: 1, debitAmount: 10000, creditAmount: 0 },
    { accountId: 2, debitAmount: 0, creditAmount: 10000 },
  ],
});

vi.mock('../domain/JournalEngine.js', () => ({
  JournalEngine: {
    checkPeriodOpen: (...args: unknown[]) => checkPeriodOpen(...args),
    post: (...args: unknown[]) => postJournal(...args),
  },
}));

vi.mock('../domain/PostingMatrixService.js', () => ({
  PostingMatrixService: {
    buildJournalEntry: (...args: unknown[]) => buildJournalEntry(...args),
  },
}));

const baseEvent = {
  eventId: 'evt-1',
  eventType: 'EMPLOYEE_LOAN_DISBURSED',
  schemaVersion: 1,
  aggregateType: 'employee_loan',
  aggregateId: 1,
  tenantId: 1,
  userId: 7,
  correlationId: 'c-1',
  causationId: 'c-1',
  occurredAt: new Date().toISOString(),
};

describe('handleEmployeeLoanDisbursed', () => {
  beforeEach(() => {
    checkPeriodOpen.mockClear();
    postJournal.mockClear();
    buildJournalEntry.mockClear();
  });

  it('posts a DR Employee Loans Receivable / CR Cash journal for the disbursed amount', async () => {
    const { handleEmployeeLoanDisbursed } = await import('../consumers/EmployeeLoanAccountingConsumer.js');

    await handleEmployeeLoanDisbursed(
      { ...baseEvent, payload: { employeeLoanId: 1, employeeId: 10, principalAmount: '10000', disbursedAmount: '10000' } } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ eventType: 'EMPLOYEE_LOAN_DISBURSED', amount: 10000, referenceType: 'EMPLOYEE_LOAN', referenceId: 1 })
    );
    expect(postJournal).toHaveBeenCalledTimes(1);
  });

  it('skips posting when the disbursed amount is zero', async () => {
    const { handleEmployeeLoanDisbursed } = await import('../consumers/EmployeeLoanAccountingConsumer.js');

    await handleEmployeeLoanDisbursed(
      { ...baseEvent, payload: { employeeLoanId: 2, employeeId: 11, principalAmount: '0', disbursedAmount: '0' } } as never,
      {} as never
    );

    expect(buildJournalEntry).not.toHaveBeenCalled();
    expect(postJournal).not.toHaveBeenCalled();
  });
});
