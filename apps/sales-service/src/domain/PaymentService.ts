import { and, eq, sql, desc } from 'drizzle-orm';
import { payments, paymentAllocations, invoices, projectionDashboardDaily, projectionCustomerBalance, outboxEvents } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

export interface CreatePaymentParams {
  tenantId: number;
  branchId: number;
  customerId: number;
  paymentNumber: string;
  paymentDate: Date;
  paymentMode: 'CASH' | 'CARD' | 'UPI' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'CREDIT_NOTE' | 'ADVANCE';
  amount: number;
  chequeNumber?: string;
  chequeBankName?: string;
  chequeDate?: Date;
  transactionReference?: string;
  notes?: string;
  posSessionId?: number;
  createdBy: number;
}

export class PaymentService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreatePaymentParams): Promise<number> {
    const [row] = await this.db
      .insert(payments)
      .values({
        tenantId: params.tenantId,
        branchId: params.branchId,
        paymentNumber: params.paymentNumber,
        customerId: params.customerId,
        paymentDate: params.paymentDate,
        paymentMode: params.paymentMode,
        amount: String(params.amount),
        allocatedAmount: '0',
        unallocatedAmount: String(params.amount),
        status: 'RECEIVED',
        chequeNumber: params.chequeNumber,
        chequeBankName: params.chequeBankName,
        chequeDate: params.chequeDate,
        transactionReference: params.transactionReference,
        notes: params.notes,
        posSessionId: params.posSessionId,
        createdBy: params.createdBy,
      })
      .returning({ id: payments.id });

    if (!row) throw new BusinessError('PAYMENT_CREATE_FAILED', 'Failed to create payment');

    // Publish outbox event
    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'PAYMENT_RECEIVED',
      aggregateType: 'Payment',
      aggregateId: row.id,
      tenantId: params.tenantId,
      payload: { paymentId: row.id, customerId: params.customerId, amount: params.amount, paymentMode: params.paymentMode },
      published: false,
    });

    return row.id;
  }

  async allocate(
    paymentId: number,
    tenantId: number,
    allocations: Array<{ invoiceId: number; amount: number }>,
    userId: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [payment] = await trx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));
      if (!payment) throw new NotFoundError('Payment not found');

      const totalToAllocate = allocations.reduce((s, a) => s + a.amount, 0);
      const unallocated = parseFloat(String(payment.unallocatedAmount));
      if (totalToAllocate > unallocated + 0.01) {
        throw new BusinessError('OVER_ALLOCATION', `Cannot allocate ${totalToAllocate} — only ${unallocated} unallocated`);
      }

      for (const alloc of allocations) {
        const [invoice] = await trx
          .select({ balanceDue: invoices.balanceDue, status: invoices.status, customerId: invoices.customerId, grandTotal: invoices.grandTotal })
          .from(invoices)
          .where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.tenantId, tenantId)));
        if (!invoice) throw new NotFoundError(`Invoice ${alloc.invoiceId} not found`);
        if (!['CONFIRMED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
          throw new BusinessError('INVALID_INVOICE_STATUS', `Invoice ${alloc.invoiceId} cannot receive payment in status ${invoice.status}`);
        }

        await trx.insert(paymentAllocations).values({
          paymentId,
          invoiceId: alloc.invoiceId,
          tenantId,
          amount: String(alloc.amount),
          allocatedBy: userId,
        });

        // Update invoice balance and status
        const newBalance = Math.max(0, parseFloat(String(invoice.balanceDue)) - alloc.amount);
        const newInvoiceStatus = newBalance <= 0.01 ? 'PAID' : 'PARTIALLY_PAID';
        await trx
          .update(invoices)
          .set({
            paidAmount: sql`${invoices.paidAmount} + ${alloc.amount}`,
            balanceDue: String(newBalance),
            status: newInvoiceStatus,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.tenantId, tenantId)));

        // Update customer projection
        await trx
          .update(projectionCustomerBalance)
          .set({
            currentBalance: sql`${projectionCustomerBalance.currentBalance} - ${alloc.amount}`,
            totalPaid: sql`${projectionCustomerBalance.totalPaid} + ${alloc.amount}`,
            lastPaymentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(
            eq(projectionCustomerBalance.tenantId, tenantId),
            eq(projectionCustomerBalance.customerId, invoice.customerId)
          ));
      }

      // Update payment allocated/unallocated amounts and status
      const newAllocated = parseFloat(String(payment.allocatedAmount)) + totalToAllocate;
      const newUnallocated = parseFloat(String(payment.unallocatedAmount)) - totalToAllocate;
      const newPaymentStatus = newUnallocated <= 0.01 ? 'FULLY_ALLOCATED' : 'PARTIALLY_ALLOCATED';
      await trx
        .update(payments)
        .set({
          allocatedAmount: String(newAllocated),
          unallocatedAmount: String(Math.max(0, newUnallocated)),
          status: newPaymentStatus,
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));

      // Dashboard projection: collected amount
      const dateKey = new Date(payment.paymentDate);
      dateKey.setHours(0, 0, 0, 0);
      await trx
        .update(projectionDashboardDaily)
        .set({
          collectedAmount: sql`${projectionDashboardDaily.collectedAmount} + ${totalToAllocate}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(projectionDashboardDaily.tenantId, tenantId),
          eq(projectionDashboardDaily.branchId, payment.branchId),
          eq(projectionDashboardDaily.date, dateKey)
        ));
    });
  }

  async bounceCheque(paymentId: number, tenantId: number, reason: string): Promise<void> {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.paymentMode !== 'CHEQUE')
      throw new BusinessError('NOT_CHEQUE', 'Only cheque payments can be bounced');

    await this.db
      .update(payments)
      .set({ status: 'BOUNCED', bouncedAt: new Date(), bounceReason: reason, updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));

    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'CHEQUE_BOUNCED',
      aggregateType: 'Payment',
      aggregateId: paymentId,
      tenantId,
      payload: { paymentId, customerId: payment.customerId, amount: payment.amount, reason },
      published: false,
    });
  }

  async getCustomerOutstanding(customerId: number, tenantId: number) {
    return this.db
      .select()
      .from(invoices)
      .where(and(
        eq(invoices.customerId, customerId),
        eq(invoices.tenantId, tenantId),
        sql`${invoices.status} IN ('CONFIRMED', 'PARTIALLY_PAID', 'OVERDUE')`
      ))
      .orderBy(desc(invoices.dueDate));
  }
}
