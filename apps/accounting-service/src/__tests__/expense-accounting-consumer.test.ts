/**
 * Audit finding 2026-07-23 (Critical): ExpenseAccountingConsumer read `p.grandTotal`, a field
 * the producer (purchase-service ExpenseService) never sends — it sends `totalAmount`. Every
 * expense approval/payment silently posted a phantom ₹0 journal (JournalEngine.post only
 * rejects *unbalanced* journals; 0 vs 0 passes trivially), with no error and no GL trail for
 * the real amount. No test existed for this consumer, which is why it was never caught.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPeriodOpen = vi.fn().mockResolvedValue(undefined);
const postJournal = vi.fn().mockResolvedValue({ journalId: 'J1', linesPosted: 2 });
const buildJournalEntry = vi.fn().mockResolvedValue({
  description: 'Expense approved',
  referenceType: 'EXPENSE',
  referenceId: 1,
  lines: [],
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
  eventType: 'EXPENSE_APPROVED',
  schemaVersion: 1,
  aggregateType: 'Expense',
  aggregateId: 1,
  tenantId: 1,
  userId: 7,
  correlationId: 'c-1',
  causationId: 'c-1',
  occurredAt: new Date().toISOString(),
};

describe('handleExpenseApproved / handleExpensePaid', () => {
  beforeEach(() => {
    checkPeriodOpen.mockClear();
    postJournal.mockClear();
    buildJournalEntry.mockClear();
  });

  it('posts the real totalAmount from the producer payload, not zero', async () => {
    const { handleExpenseApproved } = await import('../consumers/ExpenseAccountingConsumer.js');

    await handleExpenseApproved(
      {
        ...baseEvent,
        payload: {
          expenseId: 1,
          expenseNumber: 'EXP-001',
          totalAmount: '5000.00',
          category: 'Rent',
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ amount: 5000 })
    );
  });

  it('does not read a nonexistent grandTotal field (regression guard for the ₹0 phantom-journal bug)', async () => {
    const { handleExpenseApproved } = await import('../consumers/ExpenseAccountingConsumer.js');

    await handleExpenseApproved(
      {
        ...baseEvent,
        payload: {
          expenseId: 2,
          expenseNumber: 'EXP-002',
          totalAmount: '1200.50',
          grandTotal: '999999', // must NOT be read — proves the fix isn't accidentally reverted
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ amount: 1200.5 })
    );
  });

  it('posts the real totalAmount for EXPENSE_PAID too', async () => {
    const { handleExpensePaid } = await import('../consumers/ExpenseAccountingConsumer.js');

    await handleExpensePaid(
      {
        ...baseEvent,
        eventType: 'EXPENSE_PAID',
        payload: {
          expenseId: 3,
          expenseNumber: 'EXP-003',
          totalAmount: '750',
          paymentMode: 'BANK',
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith({}, 1, expect.objectContaining({ amount: 750 }));
  });
});
