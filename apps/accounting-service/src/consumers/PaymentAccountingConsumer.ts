import type { ERPEventPayload } from '@erp/types';
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
  originalJournalId?: string;
}

export async function handlePaymentReceived(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as PaymentPayload;
  const amount = Number(p.amount ?? 0);

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'PAYMENT_RECEIVED',
      description: `Payment received — ${p.paymentMode ?? 'CASH'} ₹${amount.toFixed(2)}`,
      referenceType: 'PAYMENT',
      referenceId: p.paymentId,
      amount,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, paymentId: p.paymentId }, 'Accounting: PAYMENT_RECEIVED posted');
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

  try {
    await JournalEngine.checkPeriodOpen(db, event.tenantId, new Date());

    const journalEntry = await PostingMatrixService.buildJournalEntry(db, event.tenantId, {
      eventType: 'SUPPLIER_PAYMENT_MADE',
      description: `Supplier payment — ₹${amount.toFixed(2)}`,
      referenceType: 'SUPPLIER_PAYMENT',
      referenceId: p.paymentId,
      amount,
    });

    const result = await JournalEngine.post(db, event.tenantId, event.userId, journalEntry);
    logger.info({ journalId: result.journalId, paymentId: p.paymentId }, 'Accounting: SUPPLIER_PAYMENT_MADE posted');
  } catch (err) {
    logger.error({ err, paymentId: p.paymentId }, 'Accounting: failed to post SUPPLIER_PAYMENT_MADE');
    throw err;
  }
}

export async function handleChequeBounced(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as ChequeBounced;

  try {
    // Find the original PAYMENT_RECEIVED journal for this payment
    const [original] = await db.raw.execute(
      `SELECT journal_id FROM journals
       WHERE tenant_id = ${event.tenantId}
         AND reference_type = 'PAYMENT'
         AND reference_id = ${p.paymentId}
         AND is_reversal = false
         AND status = 'POSTED'
       LIMIT 1`
    ) as { journal_id: string }[];

    if (!original?.journal_id) {
      logger.warn({ paymentId: p.paymentId }, 'Accounting: no posted payment journal — skipping cheque bounce reversal');
      return;
    }

    const result = await JournalEngine.reverse(
      db, event.tenantId, event.userId, original.journal_id,
      `Reversal: Cheque bounced for payment ${p.paymentId}`
    );
    logger.info({ journalId: result.journalId, paymentId: p.paymentId }, 'Accounting: CHEQUE_BOUNCED reversed');
  } catch (err) {
    logger.error({ err, paymentId: p.paymentId }, 'Accounting: failed to reverse CHEQUE_BOUNCED');
    throw err;
  }
}
