import { sql } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import { BusinessError } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { JournalEngine } from '../domain/JournalEngine.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const logger = createLogger({ serviceName: 'accounting-service' });

interface PaymentPayload {
  paymentId: number;
  amount: string | number;
  customerId?: number;
  supplierId?: number;
  paymentMode?: string;
  referenceNumber?: string;
}

interface ChequeBounced {
  paymentId: number;
  amount: string | number;
  customerId?: number;
  supplierId?: number;
  originalJournalId?: string;
}

export async function handlePaymentReceived(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PaymentPayload;
  const amount = Number(p.amount ?? 0);

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'PAYMENT_RECEIVED',
      description: `Payment received — ${p.paymentMode ?? 'CASH'} ₹${amount.toFixed(2)}`,
      referenceType: 'PAYMENT',
      referenceId: p.paymentId,
      amount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, paymentId: p.paymentId },
      'Accounting: PAYMENT_RECEIVED posted'
    );
  } catch (err) {
    logger.error({ err, paymentId: p.paymentId }, 'Accounting: failed to post PAYMENT_RECEIVED');
    throw err;
  }
}

export async function handleSupplierPaymentMade(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PaymentPayload;
  const amount = Number(p.amount ?? 0);

  const postingDate = new Date(event.occurredAt);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, postingDate);

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'SUPPLIER_PAYMENT_MADE',
      description: `Supplier payment — ₹${amount.toFixed(2)}`,
      referenceType: 'SUPPLIER_PAYMENT',
      referenceId: p.paymentId,
      amount,
      postingDate,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info(
      { journalId: result.journalId, paymentId: p.paymentId },
      'Accounting: SUPPLIER_PAYMENT_MADE posted'
    );
  } catch (err) {
    logger.error(
      { err, paymentId: p.paymentId },
      'Accounting: failed to post SUPPLIER_PAYMENT_MADE'
    );
    throw err;
  }
}

export async function handleChequeBounced(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as ChequeBounced;
  // Customer receipts post their journal with referenceType 'PAYMENT'
  // (PaymentAccountingConsumer.handlePaymentReceived above); supplier payments post
  // with 'SUPPLIER_PAYMENT' (handleSupplierPaymentMade below). Both share this same
  // CHEQUE_BOUNCED event/handler, so the lookup must match whichever side bounced —
  // it previously always looked for 'PAYMENT', so a bounced supplier cheque could
  // never find its original journal and silently never reversed.
  const referenceType = p.supplierId !== undefined ? 'SUPPLIER_PAYMENT' : 'PAYMENT';

  try {
    // Find the original payment journal for this payment
    const [original] = (await db.raw.execute(
      sql`SELECT journal_id FROM journals
       WHERE tenant_id = ${event.tenantId}
         AND reference_type = ${referenceType}
         AND reference_id = ${p.paymentId}
         AND is_reversal = false
         AND status = 'POSTED'
       LIMIT 1`
    )) as { journal_id: string }[];

    if (!original?.journal_id) {
      // A payment can only reach BOUNCED after previously being recorded as received/made
      // (PaymentService/SupplierPaymentService only reverses allocations on an already-PAID
      // invoice), and that recording always posts a journal — so a missing journal here means
      // something upstream genuinely went wrong, not a normal path. Throw so Kafka retries/DLQs
      // this instead of silently leaving the bounce unreconciled in the ledger.
      throw new BusinessError(
        'JOURNAL_NOT_FOUND_FOR_REVERSAL',
        `No posted payment journal found for bounced payment ${p.paymentId} — cannot reverse`
      );
    }

    const result = await JournalEngine.reverse(
      db,
      event.tenantId,
      event.userId,
      original.journal_id,
      `Reversal: Cheque bounced for payment ${p.paymentId}`
    );
    logger.info(
      { journalId: result.journalId, paymentId: p.paymentId },
      'Accounting: CHEQUE_BOUNCED reversed'
    );
  } catch (err) {
    logger.error({ err, paymentId: p.paymentId }, 'Accounting: failed to reverse CHEQUE_BOUNCED');
    throw err;
  }
}
