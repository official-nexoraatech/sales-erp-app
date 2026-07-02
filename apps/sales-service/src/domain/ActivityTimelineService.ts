import { and, eq } from 'drizzle-orm';
import { invoices, payments, saleReturns, alterationOrders, loyaltyTransactions, customerInteractions } from '@erp/db';
import type { ErpDatabase } from '@erp/db';

export type ActivityType =
  | 'INVOICE'
  | 'PAYMENT'
  | 'RETURN'
  | 'ALTERATION'
  | 'LOYALTY_EARN'
  | 'LOYALTY_REDEEM'
  | 'LOYALTY_EXPIRE'
  | 'VISIT'
  | 'CALL'
  | 'COMPLAINT'
  | 'EMAIL'
  | 'WHATSAPP'
  | 'OTHER';

export interface ActivityItem {
  type: ActivityType;
  date: string;
  id: number;
  [key: string]: unknown;
}

const LOYALTY_TYPE_MAP: Record<string, ActivityType> = {
  EARN: 'LOYALTY_EARN',
  REDEEM: 'LOYALTY_REDEEM',
  EXPIRE: 'LOYALTY_EXPIRE',
  BIRTHDAY_BONUS: 'LOYALTY_EARN',
  ADJUSTMENT: 'LOYALTY_EARN',
};

/** M9.1 — Customer 360 Activity Timeline: aggregates every customer touchpoint into one chronological feed. */
export class ActivityTimelineService {
  static async build(
    db: ErpDatabase,
    tenantId: number,
    customerId: number,
    page: number,
    size: number
  ): Promise<{ items: ActivityItem[]; total: number }> {
    const [invoiceRows, paymentRows, returnRows, alterationRows, loyaltyRows, interactionRows] = await Promise.all([
      db
        .select({ id: invoices.id, date: invoices.invoiceDate, number: invoices.invoiceNumber, amount: invoices.grandTotal, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.customerId, customerId), eq(invoices.tenantId, tenantId))),
      db
        .select({ id: payments.id, date: payments.paymentDate, amount: payments.amount, mode: payments.paymentMode })
        .from(payments)
        .where(and(eq(payments.customerId, customerId), eq(payments.tenantId, tenantId))),
      db
        .select({ id: saleReturns.id, date: saleReturns.returnDate, amount: saleReturns.totalAmount, reason: saleReturns.reason })
        .from(saleReturns)
        .where(and(eq(saleReturns.customerId, customerId), eq(saleReturns.tenantId, tenantId))),
      db
        .select({ id: alterationOrders.id, date: alterationOrders.receivedDate, status: alterationOrders.status, chargeAmount: alterationOrders.totalAmount })
        .from(alterationOrders)
        .where(and(eq(alterationOrders.customerId, customerId), eq(alterationOrders.tenantId, tenantId))),
      db
        .select({ id: loyaltyTransactions.id, date: loyaltyTransactions.createdAt, type: loyaltyTransactions.type, points: loyaltyTransactions.points, balance: loyaltyTransactions.balanceAfter })
        .from(loyaltyTransactions)
        .where(and(eq(loyaltyTransactions.customerId, customerId), eq(loyaltyTransactions.tenantId, tenantId))),
      db
        .select({ id: customerInteractions.id, date: customerInteractions.createdAt, type: customerInteractions.type, notes: customerInteractions.notes })
        .from(customerInteractions)
        .where(and(eq(customerInteractions.customerId, customerId), eq(customerInteractions.tenantId, tenantId))),
    ]);

    const items: ActivityItem[] = [
      ...invoiceRows.map((r) => ({ type: 'INVOICE' as const, date: new Date(r.date).toISOString(), id: r.id, number: r.number, amount: r.amount, status: r.status })),
      ...paymentRows.map((r) => ({ type: 'PAYMENT' as const, date: new Date(r.date).toISOString(), id: r.id, amount: r.amount, mode: r.mode })),
      ...returnRows.map((r) => ({ type: 'RETURN' as const, date: new Date(r.date).toISOString(), id: r.id, amount: r.amount, reason: r.reason })),
      ...alterationRows.map((r) => ({ type: 'ALTERATION' as const, date: new Date(r.date).toISOString(), id: r.id, status: r.status, chargeAmount: r.chargeAmount })),
      ...loyaltyRows.map((r) => ({ type: LOYALTY_TYPE_MAP[r.type] ?? ('LOYALTY_EARN' as const), date: new Date(r.date).toISOString(), id: r.id, points: r.points, balance: r.balance })),
      ...interactionRows.map((r) => ({ type: r.type as ActivityType, date: new Date(r.date).toISOString(), id: r.id, notes: r.notes })),
    ];

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const total = items.length;
    const paged = items.slice(page * size, page * size + size);

    return { items: paged, total };
  }
}
