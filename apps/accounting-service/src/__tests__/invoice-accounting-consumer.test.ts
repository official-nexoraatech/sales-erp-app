import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for a live-QA finding (2026-07-17): handleInvoiceConfirmed used to
// recompute `isInterstate` from `placeOfSupply !== sellerStateCode`, but the producer
// (InvoiceService.confirm) never sends `sellerStateCode` — so this was `true` for every
// invoice, which meant the CGST/SGST posting branch never fired and every invoice's
// journal silently dropped its tax lines. The fix trusts the producer's already-correct
// `isInterstate` field directly.

const checkPeriodOpen = vi.fn().mockResolvedValue(undefined);
const postJournal = vi.fn().mockResolvedValue({ journalId: 'J1', linesPosted: 2 });
const buildJournalEntry = vi.fn().mockResolvedValue({
  description: 'Invoice confirmed',
  referenceType: 'INVOICE',
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
  eventType: 'INVOICE_CONFIRMED',
  schemaVersion: 1,
  aggregateType: 'Invoice',
  aggregateId: 1,
  tenantId: 1,
  userId: 7,
  correlationId: 'c-1',
  causationId: 'c-1',
  occurredAt: new Date().toISOString(),
};

describe('handleInvoiceConfirmed', () => {
  beforeEach(() => {
    checkPeriodOpen.mockClear();
    postJournal.mockClear();
    buildJournalEntry.mockClear();
  });

  it('passes isInterstate=false through for an intrastate invoice (CGST/SGST), not derived from a field the producer never sends', async () => {
    const { handleInvoiceConfirmed } = await import('../consumers/InvoiceAccountingConsumer.js');

    await handleInvoiceConfirmed(
      {
        ...baseEvent,
        payload: {
          invoiceId: 1,
          invoiceNumber: 'INV-001',
          grandTotal: '10500',
          taxableAmount: '10000',
          cgstAmount: '250',
          sgstAmount: '250',
          igstAmount: '0',
          placeOfSupply: '27',
          isInterstate: false,
          // sellerStateCode intentionally absent — matches the real producer payload shape.
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({
        isInterstate: false,
        cgstAmount: 250,
        sgstAmount: 250,
        igstAmount: 0,
      })
    );
  });

  it('passes isInterstate=true through for an interstate invoice (IGST)', async () => {
    const { handleInvoiceConfirmed } = await import('../consumers/InvoiceAccountingConsumer.js');

    await handleInvoiceConfirmed(
      {
        ...baseEvent,
        payload: {
          invoiceId: 2,
          invoiceNumber: 'INV-002',
          grandTotal: '10500',
          taxableAmount: '10000',
          cgstAmount: '0',
          sgstAmount: '0',
          igstAmount: '500',
          placeOfSupply: '19',
          isInterstate: true,
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ isInterstate: true, igstAmount: 500 })
    );
  });

  it('defaults to isInterstate=false when the field is missing (fail-safe: still attempts CGST/SGST from the real amounts rather than silently dropping tax lines)', async () => {
    const { handleInvoiceConfirmed } = await import('../consumers/InvoiceAccountingConsumer.js');

    await handleInvoiceConfirmed(
      {
        ...baseEvent,
        payload: {
          invoiceId: 3,
          invoiceNumber: 'INV-003',
          grandTotal: '10500',
          taxableAmount: '10000',
          cgstAmount: '250',
          sgstAmount: '250',
          igstAmount: '0',
          placeOfSupply: '27',
        },
      } as never,
      {} as never
    );

    expect(buildJournalEntry).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ isInterstate: false })
    );
  });
});
