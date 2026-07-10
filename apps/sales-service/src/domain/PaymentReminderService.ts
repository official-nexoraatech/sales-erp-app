import { and, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { invoices, customers, customerInteractions } from '@erp/db';

export interface ReminderCandidate {
  customerId: number;
  displayName: string;
  phone: string;
  email: string | null;
  optOutSms: boolean;
  optOutWhatsapp: boolean;
  optOutEmail: boolean;
  overdueTotal: number;
  invoiceCount: number;
}

export function shouldSendChannel(
  customer: { optOutSms: boolean; optOutWhatsapp: boolean; optOutEmail: boolean },
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL'
): boolean {
  if (channel === 'SMS') return !customer.optOutSms;
  if (channel === 'WHATSAPP') return !customer.optOutWhatsapp;
  return !customer.optOutEmail;
}

export class PaymentReminderService {
  /**
   * Customers with OVERDUE, unpaid-balance invoices who have not already had a
   * reminder logged today — dedup is a SYSTEM-type customer_interactions row
   * created earlier today (ES-18: "Do NOT resend if already sent today").
   */
  static async findCandidates(db: ErpDatabase, tenantId: number): Promise<ReminderCandidate[]> {
    const overdue = await db
      .select({
        customerId: invoices.customerId,
        overdueTotal: sql<string>`sum(${invoices.balanceDue})`,
        invoiceCount: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'OVERDUE'), gt(invoices.balanceDue, '0')))
      .groupBy(invoices.customerId);

    if (overdue.length === 0) return [];

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const remindedToday = await db
      .select({ customerId: customerInteractions.customerId })
      .from(customerInteractions)
      .where(
        and(
          eq(customerInteractions.tenantId, tenantId),
          eq(customerInteractions.type, 'SYSTEM'),
          gte(customerInteractions.createdAt, startOfDay),
          inArray(customerInteractions.customerId, overdue.map((o) => o.customerId))
        )
      );
    const remindedIds = new Set(remindedToday.map((r) => r.customerId));

    const pendingCustomerIds = overdue.map((o) => o.customerId).filter((id) => !remindedIds.has(id));
    if (pendingCustomerIds.length === 0) return [];

    const customerRows = await db
      .select({
        id: customers.id,
        displayName: customers.displayName,
        phone: customers.phone,
        email: customers.email,
        optOutSms: customers.optOutSms,
        optOutWhatsapp: customers.optOutWhatsapp,
        optOutEmail: customers.optOutEmail,
      })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, pendingCustomerIds), isNull(customers.deletedAt)));

    const overdueById = new Map(overdue.map((o) => [o.customerId, o]));
    return customerRows.map((c) => {
      const o = overdueById.get(c.id);
      return {
        customerId: c.id,
        displayName: c.displayName,
        phone: c.phone,
        email: c.email,
        optOutSms: c.optOutSms,
        optOutWhatsapp: c.optOutWhatsapp,
        optOutEmail: c.optOutEmail,
        overdueTotal: parseFloat(o?.overdueTotal ?? '0'),
        invoiceCount: o?.invoiceCount ?? 0,
      };
    });
  }
}
