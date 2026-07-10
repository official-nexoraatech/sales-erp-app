import { eq, and } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import { invoices, customers } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'sales-service' });

export class InvoiceNotificationService {
  /**
   * Best-effort WhatsApp/Email notice to the customer once an invoice is confirmed — ES-18.
   * Never throws: a notification-service outage must not block invoice confirmation.
   */
  static async notifyInvoiceConfirmed(ctx: PlatformContext, invoiceId: number): Promise<void> {
    try {
      const [invoice] = await ctx.db.raw
        .select({ invoiceNumber: invoices.invoiceNumber, grandTotal: invoices.grandTotal, dueDate: invoices.dueDate, customerId: invoices.customerId })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenant.tenantId)));
      if (!invoice) return;

      const [customer] = await ctx.db.raw
        .select({
          displayName: customers.displayName,
          phone: customers.phone,
          email: customers.email,
          optOutWhatsapp: customers.optOutWhatsapp,
          optOutEmail: customers.optOutEmail,
        })
        .from(customers)
        .where(and(eq(customers.id, invoice.customerId), eq(customers.tenantId, ctx.tenant.tenantId)));
      if (!customer) return;
      if (customer.optOutWhatsapp && customer.optOutEmail) return;

      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const dueDateStr = invoice.dueDate.toISOString().slice(0, 10);
      const body = `Hi ${customer.displayName}, your invoice ${invoice.invoiceNumber} for Rs. ${invoice.grandTotal} is confirmed. Due by ${dueDateStr}.`;

      const send = (channel: 'WHATSAPP' | 'EMAIL', extra: Record<string, string>) =>
        fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({ tenantId: ctx.tenant.tenantId, eventType: 'INVOICE_CONFIRMED', channel, body, ...extra }),
        }).catch((err) => logger.warn({ err, invoiceId, channel }, 'Invoice-confirmed notification delivery failed'));

      if (!customer.optOutWhatsapp && customer.phone) {
        await send('WHATSAPP', { recipientPhone: customer.phone });
      }
      if (!customer.optOutEmail && customer.email) {
        await send('EMAIL', { recipientEmail: customer.email, subject: `Invoice ${invoice.invoiceNumber} confirmed` });
      }
    } catch (err) {
      logger.warn({ err, invoiceId }, 'Invoice-confirmed notification failed (non-fatal)');
    }
  }
}
