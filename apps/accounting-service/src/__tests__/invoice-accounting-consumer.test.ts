import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for a live-QA finding (2026-07-17): handleInvoiceConfirmed used to
// recompute `isInterstate` from `placeOfSupply !== sellerStateCode`, but the producer
// (InvoiceService.confirm) never sends `sellerStateCode` — so this was `true` for every
// invoice, which meant the CGST/SGST posting branch never fired and every invoice's
// journal silently dropped its tax lines. The fix trusts the producer's already-correct
// `isInterstate` field directly.

const checkPeriodOpen = vi.fn().mockResolvedValue(undefined);
const postJournal = vi.fn().mockResolvedValue({ journalId: 'J1', linesPosted: 2 });
const reverseJournal = vi.fn().mockResolvedValue({ journalId: 'REV1', linesPosted: 2 });
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
    reverse: (...args: unknown[]) => reverseJournal(...args),
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

// Regression test: a confirmed, costed invoice has TWO posted journals sharing the same
// reference pair (reference_type='INVOICE', reference_id=<id>) — the revenue/AR/GST journal
// from handleInvoiceConfirmed and the separate COGS/Inventory journal from
// handleCogsCalculated. Cancellation used to look up "the" journal with `LIMIT 1` and reverse
// only one of them, non-deterministically. It must now reverse every posted, non-reversal
// journal for that reference.
describe('handleInvoiceCancelled', () => {
  beforeEach(() => {
    reverseJournal.mockClear();
  });

  it('reverses both the revenue journal and the COGS journal when both were posted', async () => {
    const { handleInvoiceCancelled } = await import('../consumers/InvoiceAccountingConsumer.js');

    const execute = vi
      .fn()
      .mockResolvedValue([{ journal_id: 'J-REVENUE' }, { journal_id: 'J-COGS' }]);
    const db = { raw: { execute } };

    await handleInvoiceCancelled(
      {
        ...baseEvent,
        eventType: 'INVOICE_CANCELLED',
        payload: { invoiceId: 1, invoiceNumber: 'INV-001' },
      } as never,
      db as never
    );

    expect(reverseJournal).toHaveBeenCalledTimes(2);
    expect(reverseJournal).toHaveBeenCalledWith(db, 1, 7, 'J-REVENUE', expect.any(String));
    expect(reverseJournal).toHaveBeenCalledWith(db, 1, 7, 'J-COGS', expect.any(String));
  });

  it('reverses a single journal when only one was posted (COGS not yet calculated)', async () => {
    const { handleInvoiceCancelled } = await import('../consumers/InvoiceAccountingConsumer.js');

    const execute = vi.fn().mockResolvedValue([{ journal_id: 'J-REVENUE' }]);
    const db = { raw: { execute } };

    await handleInvoiceCancelled(
      {
        ...baseEvent,
        eventType: 'INVOICE_CANCELLED',
        payload: { invoiceId: 2, invoiceNumber: 'INV-002' },
      } as never,
      db as never
    );

    expect(reverseJournal).toHaveBeenCalledTimes(1);
    expect(reverseJournal).toHaveBeenCalledWith(db, 1, 7, 'J-REVENUE', expect.any(String));
  });

  // Audit finding 2026-07-23: this used to warn-and-return, silently treating an unreconciled
  // cancellation as handled. The producer only emits INVOICE_CANCELLED for a previously-
  // CONFIRMED invoice, which always posts a journal first, so a missing journal here is a
  // genuine anomaly — it must now throw so Kafka retries/DLQs it instead of silently succeeding.
  it('throws instead of silently succeeding when no posted journal exists', async () => {
    const { handleInvoiceCancelled } = await import('../consumers/InvoiceAccountingConsumer.js');

    const execute = vi.fn().mockResolvedValue([]);
    const db = { raw: { execute } };

    await expect(
      handleInvoiceCancelled(
        {
          ...baseEvent,
          eventType: 'INVOICE_CANCELLED',
          payload: { invoiceId: 3, invoiceNumber: 'INV-003' },
        } as never,
        db as never
      )
    ).rejects.toThrow();

    expect(reverseJournal).not.toHaveBeenCalled();
  });
});
