import type { ERPEventPayload } from '@erp/types';
import { BusinessError } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface InvoiceConfirmedPayload {
  invoiceId: number;
  invoiceNumber: string;
  customerId?: number;
  grandTotal: string | number;
  taxableAmount?: string | number;
  cgstAmount?: string | number;
  sgstAmount?: string | number;
  igstAmount?: string | number;
  placeOfSupply?: string;
  isInterstate?: boolean;
}

interface InvoiceCancelledPayload {
  invoiceId: number;
  invoiceNumber: string;
  originalJournalId?: string;
}

export async function handleInvoiceConfirmed(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as InvoiceConfirmedPayload;

  const grandTotal = Number(p.grandTotal ?? 0);
  const taxableAmount = Number(p.taxableAmount ?? grandTotal);
  const cgstAmount = Number(p.cgstAmount ?? 0);
  const sgstAmount = Number(p.sgstAmount ?? 0);
  const igstAmount = Number(p.igstAmount ?? 0);
  // The producer (InvoiceService.confirm) already computes this correctly from
  // igstAmount > 0 — recomputing it here from placeOfSupply/sellerStateCode was wrong: the
  // producer never sends sellerStateCode, so that comparison was `true` for every invoice,
  // which meant the CGST/SGST posting branch never fired and tax lines were silently
  // dropped from every invoice-confirmation journal (found in live QA 2026-07-17).
  const isInterstate = p.isInterstate ?? false;

  // Tag the journal to the period the event actually occurred in, not whichever period this
  // Kafka consumer happens to be processing it in (a backlog/retry could otherwise post a
  // March-dated invoice into April's period and let it slip past a March period-close).
  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'INVOICE_CONFIRMED',
      description: `Invoice ${p.invoiceNumber} confirmed`,
      referenceType: 'INVOICE',
      referenceId: p.invoiceId,
      amount: grandTotal,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      isInterstate,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, invoiceId: p.invoiceId },
      'Accounting: INVOICE_CONFIRMED posted'
    );
  } catch (err) {
    logger.error({ err, invoiceId: p.invoiceId }, 'Accounting: failed to post INVOICE_CONFIRMED');
    throw err;
  }
}

export async function handleInvoiceCancelled(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as InvoiceCancelledPayload;

  try {
    // A confirmed, costed invoice has up to two independently-posted journals sharing this
    // same reference pair: the revenue/AR/GST journal (INVOICE_CONFIRMED, this consumer) and
    // the COGS/Inventory journal (COGS_CALCULATED, CogsAccountingConsumer). Both must be
    // reversed on cancellation — reversing only one leaves Inventory/COGS permanently
    // misstated relative to the (correctly reversed) physical stock ledger.
    const originals = (await db.raw.execute(
      `SELECT journal_id FROM journals
       WHERE tenant_id = ${event.tenantId}
         AND reference_type = 'INVOICE'
         AND reference_id = ${p.invoiceId}
         AND is_reversal = false
         AND status = 'POSTED'`
    )) as { journal_id: string }[];

    if (originals.length === 0) {
      // The producer only emits INVOICE_CANCELLED for a previously-CONFIRMED invoice
      // (InvoiceService.cancel, guarded on invoice.status === 'CONFIRMED'), which always posts
      // a journal first — so zero posted journals here means something upstream genuinely went
      // wrong (e.g. accounting-service was down when INVOICE_CONFIRMED fired), not a normal
      // "cancel a draft" path. Throwing lets Kafka retry/DLQ this instead of silently treating
      // an unreconciled cancellation as handled.
      throw new BusinessError(
        'JOURNAL_NOT_FOUND_FOR_REVERSAL',
        `No posted journal found for cancelled invoice ${p.invoiceId} — cannot reverse`
      );
    }

    for (const original of originals) {
      const result = await JournalEngine.reverse(
        db,
        event.tenantId,
        event.userId,
        original.journal_id,
        `Reversal: Invoice ${p.invoiceNumber} cancelled`
      );
      logger.info(
        {
          journalId: result.journalId,
          originalJournalId: original.journal_id,
          invoiceId: p.invoiceId,
        },
        'Accounting: INVOICE_CANCELLED reversed'
      );
    }
  } catch (err) {
    logger.error(
      { err, invoiceId: p.invoiceId },
      'Accounting: failed to reverse INVOICE_CANCELLED'
    );
    throw err;
  }
}
