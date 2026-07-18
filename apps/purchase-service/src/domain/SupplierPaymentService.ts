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

    // Payment insert + supplier-balance projection + outbox event used to be three
    // separate, independently-committing statements on this.db — if the outbox insert
    // threw after the first two had already committed, the payment would be real and the
    // supplier-balance projection updated, but nothing downstream would ever learn about
    // it. All three now happen in one transaction.
    return this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      const [row] = await db
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

      if (!row)
        throw new BusinessError('PAYMENT_CREATE_FAILED', 'Failed to create supplier payment');

      await db
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

      await db.insert(outboxEvents).values({
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
    });
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
        throw new BusinessError(
          'OVER_ALLOCATION',
          `Cannot allocate ${totalToAllocate} — only ${unallocated} unallocated`
        );
      }

      for (const alloc of allocations) {
        const [grn] = await trx
          .select()
          .from(grns)
          .where(and(eq(grns.id, alloc.grnId), eq(grns.tenantId, tenantId)));
        if (!grn) throw new NotFoundError('GRN', alloc.grnId);
        if (grn.status !== 'APPROVED')
          throw new BusinessError(
            'INVALID_GRN_STATUS',
            `GRN ${alloc.grnId} must be APPROVED to receive payment`
          );

        await trx.insert(supplierPaymentAllocations).values({
          paymentId,
          grnId: alloc.grnId,
          tenantId,
          amount: String(alloc.amount),
          allocatedBy: userId,
        });
      }

      // Atomic, guarded update — mirrors sales-service's PaymentService.allocate(). The
      // previous version computed newAllocated/newUnallocated in JS from `payment` (read
      // at the top of this transaction) and wrote it back unconditionally: two concurrent
      // allocate() calls against the same payment could both read the same
      // unallocatedAmount, both pass the OVER_ALLOCATION check above, and both commit,
      // over-allocating the payment. The WHERE guard below makes Postgres reject the
      // second writer instead.
      const [updatedPayment] = await trx
        .update(supplierPayments)
        .set({
          allocatedAmount: sql`${supplierPayments.allocatedAmount} + ${totalToAllocate}`,
          unallocatedAmount: sql`${supplierPayments.unallocatedAmount} - ${totalToAllocate}`,
          status: sql`CASE WHEN ${supplierPayments.unallocatedAmount} - ${totalToAllocate} <= 0.01 THEN 'FULLY_ALLOCATED' ELSE 'PARTIALLY_ALLOCATED' END`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supplierPayments.id, paymentId),
            eq(supplierPayments.tenantId, tenantId),
            sql`${supplierPayments.unallocatedAmount} >= ${totalToAllocate}`
          )
        )
        .returning({ unallocatedAmount: supplierPayments.unallocatedAmount });

      if (!updatedPayment) {
        throw new BusinessError(
          'OVER_ALLOCATION',
          `Supplier payment ${paymentId} has insufficient unallocated balance (concurrent allocation)`
        );
      }
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

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      await db
        .update(supplierPayments)
        .set({
          status: 'BOUNCED',
          bouncedAt: new Date(),
          bounceReason: reason,
          updatedAt: new Date(),
        })
        .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, tenantId)));

      // Reverse the supplier balance reduction
      const paymentAmount = parseFloat(String(payment.amount));
      await db
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

      await db.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'CHEQUE_BOUNCED',
        aggregateType: 'SupplierPayment',
        aggregateId: paymentId,
        tenantId,
        payload: { paymentId, supplierId: payment.supplierId, amount: payment.amount, reason },
        published: false,
      });
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
      .where(
        and(
          eq(grns.supplierId, supplierId),
          eq(grns.tenantId, tenantId),
          eq(grns.status, 'APPROVED')
        )
      )
      .orderBy(desc(grns.grnDate))
      .limit(50);

    const recentPayments = await this.db
      .select()
      .from(supplierPayments)
      .where(
        and(eq(supplierPayments.supplierId, supplierId), eq(supplierPayments.tenantId, tenantId))
      )
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
