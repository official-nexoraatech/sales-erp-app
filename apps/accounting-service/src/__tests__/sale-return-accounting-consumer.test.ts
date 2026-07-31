/**
 * C-3 fix: handleSaleReturnApproved used to call buildJournalEntry with only `amount`
 * (grandTotal), dropping the GST breakdown that's been on the SALE_RETURN_APPROVED payload
 * since d9d657e. Confirms the consumer now forwards taxableAmount/cgstAmount/sgstAmount/
 * igstAmount/isInterstate through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPeriodOpen = vi.fn().mockResolvedValue(undefined);
const postJournal = vi.fn().mockResolvedValue({ journalId: 'J1', linesPosted: 2 });
const buildJournalEntry = vi.fn().mockResolvedValue({
  description: 'Sale return approved',
  referenceType: 'SALE_RETURN',
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
  eventType: 'SALE_RETURN_APPROVED',
  schemaVersion: 1,
  aggregateType: 'SaleReturn',
  aggregateId: 1,
  tenantId: 1,
  userId: 7,
  correlationId: 'c-1',
  causationId: 'c-1',
  occurredAt: new Date().toISOString(),
};

describe('handleSaleReturnApproved', () => {
  beforeEach(() => {
    checkPeriodOpen.mockClear();
    postJournal.mockClear();
    buildJournalEntry.mockClear();
  });

  it('forwards the full GST breakdown to buildJournalEntry, not just grandTotal', async () => {
    const { handleSaleReturnApproved } =
      await import('../consumers/SaleReturnAccountingConsumer.js');

    await handleSaleReturnApproved(
      {
        ...baseEvent,
        payload: {
          returnId: 1,
          returnNumber: 'RET-001',
          customerId: 5,
          grandTotal: '1050',
          taxableAmount: '1000',
          cgstAmount: '25',
          sgstAmount: '25',
          igstAmount: '0',
          isInterstate: false,
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({
        eventType: 'SALE_RETURN_APPROVED',
        amount: 1050,
        taxableAmount: 1000,
        cgstAmount: 25,
        sgstAmount: 25,
        igstAmount: 0,
        isInterstate: false,
      })
    );
  });

  it('defaults isInterstate to false and taxableAmount to grandTotal when the payload omits the GST breakdown', async () => {
    const { handleSaleReturnApproved } =
      await import('../consumers/SaleReturnAccountingConsumer.js');

    await handleSaleReturnApproved(
      {
        ...baseEvent,
        payload: { returnId: 2, returnNumber: 'RET-002', customerId: 5, grandTotal: '500' },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({
        amount: 500,
        taxableAmount: 500,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        isInterstate: false,
      })
    );
  });
});
