import { eq, and } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import { quotations, customers } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'sales-service' });

export class QuotationNotificationService {
  /**
   * Best-effort WhatsApp/Email notice to the customer once a quotation is sent — H-9 fix.
   * "Send" previously only flipped quotations.status to SENT; nothing was actually
   * transmitted to the customer. Mirrors InvoiceNotificationService.notifyInvoiceConfirmed —
   * never throws, a notification-service outage must not block sending a quotation.
   */
  static async notifyQuotationSent(ctx: PlatformContext, quotationId: number): Promise<void> {
    try {
      const [quotation] = await ctx.db.raw
        .select({
          quotationNumber: quotations.quotationNumber,
          grandTotal: quotations.grandTotal,
          validUntil: quotations.validUntil,
          customerId: quotations.customerId,
        })
        .from(quotations)
        .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, ctx.tenant.tenantId)));
      if (!quotation) return;

      const [customer] = await ctx.db.raw
        .select({
          displayName: customers.displayName,
          phone: customers.phone,
          email: customers.email,
          optOutWhatsapp: customers.optOutWhatsapp,
          optOutEmail: customers.optOutEmail,
        })
        .from(customers)
        .where(
          and(eq(customers.id, quotation.customerId), eq(customers.tenantId, ctx.tenant.tenantId))
        );
      if (!customer) return;
      if (customer.optOutWhatsapp && customer.optOutEmail) return;

      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const validUntilStr = quotation.validUntil.toISOString().slice(0, 10);
      const body = `Hi ${customer.displayName}, your quotation ${quotation.quotationNumber} for Rs. ${quotation.grandTotal} is ready. Valid until ${validUntilStr}.`;

      const send = (channel: 'WHATSAPP' | 'EMAIL', extra: Record<string, string>) =>
        fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({
            tenantId: ctx.tenant.tenantId,
            eventType: 'QUOTATION_SENT',
            channel,
            body,
            ...extra,
          }),
        }).catch((err) =>
          logger.warn({ err, quotationId, channel }, 'Quotation-sent notification delivery failed')
        );

      if (!customer.optOutWhatsapp && customer.phone) {
        await send('WHATSAPP', { recipientPhone: customer.phone });
      }
      if (!customer.optOutEmail && customer.email) {
        await send('EMAIL', {
          recipientEmail: customer.email,
          subject: `Quotation ${quotation.quotationNumber}`,
        });
      }
    } catch (err) {
      logger.warn({ err, quotationId }, 'Quotation-sent notification failed (non-fatal)');
    }
  }
}
