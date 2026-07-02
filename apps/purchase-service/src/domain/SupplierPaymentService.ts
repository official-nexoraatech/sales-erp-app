import { and, eq, sql, desc, lt, isNull } from 'drizzle-orm';
import {
  supplierPayments,
  supplierPaymentAllocations,
  grns,
  projectionSupplierBalance,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

export interface CreateSupplierPaymentParams {
  tenantId: number;
  branchId: number;
  supplierId: number;
  paymentDate: Date;
  paymentMode: 'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'UPI' | 'ADVANCE';
  amount: number;
  chequeNumber?: string | undefined;
  chequeBankName?: string | undefined;
  chequeDate?: Date | undefined;
  isPdc?: boolean | undefined;
  pdcClearingDate?: Date | undefined;
  transactionReference?: string | undefined;
  notes?: string | undefined;
  createdBy: number;
}

export class SupplierPaymentService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateSupplierPaymentParams): Promise<number> {
    const paymentNumber = `SPY-${params.tenantId}-${Date.now()}`;

    const [row] = await this.db
      .insert(supplierPayments)
      .values({
        tenantId: params.tenantId,
        branchId: params.branchId,
        paymentNumber,
        supplierId: params.supplierId,
        paymentDate: params.paymentDate,
        paymentMode: params.paymentMode,
        amount: String(params.amount),
        allocatedAmount: '0',
        unallocatedAmount: String(params.amount),
        status: 'PAID',
        chequeNumber: params.chequeNumber,
        chequeBankName: params.chequeBankName,
        chequeDate: params.chequeDate,
        isPdc: params.isPdc ?? false,
        pdcClearingDate: params.pdcClearingDate,
        transactionReference: params.transactionReference,
        notes: params.notes,
        createdBy: params.createdBy,
      })
      .returning({ id: supplierPayments.id });

    if (!row) throw new BusinessError('PAYMENT_CREATE_FAILED', 'Failed to create supplier payment');

    // Update supplier balance projection
    await this.db
      .insert(projectionSupplierBalance)
      .values({
        tenantId: params.tenantId,
        supplierId: params.supplierId,
        currentBalance: String(-params.amount),
        totalPurchased: '0',
        totalPaid: String(params.amount),
        totalReturns: '0',
        overdueAmount: '0',
        lastPaymentAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [projectionSupplierBalance.tenantId, projectionSupplierBalance.supplierId],
        set: {
          currentBalance: sql`${projectionSupplierBalance.currentBalance} - ${params.amount}`,
          totalPaid: sql`${projectionSupplierBalance.totalPaid} + ${params.amount}`,
          lastPaymentAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: params.isPdc ? 'PDC_ISSUED' : 'SUPPLIER_PAYMENT_MADE',
      aggregateType: 'SupplierPayment',
      aggregateId: row.id,
      tenantId: params.tenantId,
      payload: {
        paymentId: row.id,
        supplierId: params.supplierId,
        amount: params.amount,
        paymentMode: params.paymentMode,
        isPdc: params.isPdc ?? false,
        pdcClearingDate: params.pdcClearingDate?.toISOString(),
      },
      published: false,
    });

    return row.id;
  }

  async allocate(
    paymentId: number,
    tenantId: number,
    allocations: Array<{ grnId: number; amount: number }>,
    userId: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [payment] = await trx
        .select()
        .from(supplierPayments)
        .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, tenantId)));
      if (!payment) throw new NotFoundError('SupplierPayment', paymentId);

      const totalToAllocate = allocations.reduce((s, a) => s + a.amount, 0);
      const unallocated = parseFloat(String(payment.unallocatedAmount));
      if (totalToAllocate > unallocated + 0.01) {
        throw new BusinessError('OVER_ALLOCATION', `Cannot allocate ${totalToAllocate} — only ${unallocated} unallocated`);
      }

      for (const alloc of allocations) {
        const [grn] = await trx
          .select()
          .from(grns)
          .where(and(eq(grns.id, alloc.grnId), eq(grns.tenantId, tenantId)));
        if (!grn) throw new NotFoundError('GRN', alloc.grnId);
        if (grn.status !== 'APPROVED')
          throw new BusinessError('INVALID_GRN_STATUS', `GRN ${alloc.grnId} must be APPROVED to receive payment`);

        await trx.insert(supplierPaymentAllocations).values({
          paymentId,
          grnId: alloc.grnId,
          tenantId,
          amount: String(alloc.amount),
          allocatedBy: userId,
        });
      }

      const newAllocated = parseFloat(String(payment.allocatedAmount)) + totalToAllocate;
      const newUnallocated = parseFloat(String(payment.unallocatedAmount)) - totalToAllocate;
      const newStatus = newUnallocated <= 0.01 ? 'FULLY_ALLOCATED' : 'PARTIALLY_ALLOCATED';

      await trx
        .update(supplierPayments)
        .set({
          allocatedAmount: String(newAllocated),
          unallocatedAmount: String(Math.max(0, newUnallocated)),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, tenantId)));
    });
  }

  async bounceCheque(paymentId: number, tenantId: number, reason: string): Promise<void> {
    const [payment] = await this.db
      .select()
      .from(supplierPayments)
      .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, tenantId)));
    if (!payment) throw new NotFoundError('SupplierPayment', paymentId);
    if (payment.paymentMode !== 'CHEQUE')
      throw new BusinessError('NOT_CHEQUE', 'Only cheque payments can be bounced');

    await this.db
      .update(supplierPayments)
      .set({ status: 'BOUNCED', bouncedAt: new Date(), bounceReason: reason, updatedAt: new Date() })
      .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, tenantId)));

    // Reverse the supplier balance reduction
    const paymentAmount = parseFloat(String(payment.amount));
    await this.db
      .update(projectionSupplierBalance)
      .set({
        currentBalance: sql`${projectionSupplierBalance.currentBalance} + ${paymentAmount}`,
        totalPaid: sql`${projectionSupplierBalance.totalPaid} - ${paymentAmount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectionSupplierBalance.tenantId, tenantId),
          eq(projectionSupplierBalance.supplierId, payment.supplierId)
        )
      );

    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'CHEQUE_BOUNCED',
      aggregateType: 'SupplierPayment',
      aggregateId: paymentId,
      tenantId,
      payload: { paymentId, supplierId: payment.supplierId, amount: payment.amount, reason },
      published: false,
    });
  }

  async getOutstanding(supplierId: number, tenantId: number) {
    return this.db
      .select()
      .from(grns)
      .where(
        and(
          eq(grns.supplierId, supplierId),
          eq(grns.tenantId, tenantId),
          eq(grns.status, 'APPROVED')
        )
      )
      .orderBy(desc(grns.grnDate));
  }

  async getStatement(supplierId: number, tenantId: number) {
    const [balance] = await this.db
      .select()
      .from(projectionSupplierBalance)
      .where(
        and(
          eq(projectionSupplierBalance.supplierId, supplierId),
          eq(projectionSupplierBalance.tenantId, tenantId)
        )
      );

    const recentGrns = await this.db
      .select()
      .from(grns)
      .where(and(eq(grns.supplierId, supplierId), eq(grns.tenantId, tenantId), eq(grns.status, 'APPROVED')))
      .orderBy(desc(grns.grnDate))
      .limit(50);

    const recentPayments = await this.db
      .select()
      .from(supplierPayments)
      .where(and(eq(supplierPayments.supplierId, supplierId), eq(supplierPayments.tenantId, tenantId)))
      .orderBy(desc(supplierPayments.paymentDate))
      .limit(50);

    return { balance, recentGrns, recentPayments };
  }

  async getPdcDueInDays(tenantId: number, days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    return this.db
      .select()
      .from(supplierPayments)
      .where(
        and(
          eq(supplierPayments.tenantId, tenantId),
          eq(supplierPayments.isPdc, true),
          eq(supplierPayments.status, 'PAID'),
          lt(supplierPayments.pdcClearingDate, cutoff),
          isNull(supplierPayments.pdcAlertSentAt)
        )
      );
  }

  async markPdcAlertSent(paymentId: number): Promise<void> {
    await this.db
      .update(supplierPayments)
      .set({ pdcAlertSentAt: new Date(), updatedAt: new Date() })
      .where(eq(supplierPayments.id, paymentId));
  }
}
