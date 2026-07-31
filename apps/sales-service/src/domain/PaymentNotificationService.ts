import { eq, and } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import { payments, customers } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'sales-service' });

export class PaymentNotificationService {
  /**
   * Best-effort WhatsApp/Email receipt to the customer once a payment is recorded — H-9 fix.
   * Payment creation previously only enqueued a tenant-configured outbound webhook (a
   * third-party integration mechanism), with no customer-facing acknowledgment at all.
   * Mirrors InvoiceNotificationService.notifyInvoiceConfirmed — never throws, a
   * notification-service outage must not block payment recording.
   */
  static async notifyPaymentReceived(ctx: PlatformContext, paymentId: number): Promise<void> {
    try {
      const [payment] = await ctx.db.raw
        .select({
          paymentNumber: payments.paymentNumber,
          amount: payments.amount,
          paymentMode: payments.paymentMode,
          customerId: payments.customerId,
        })
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.tenantId, ctx.tenant.tenantId)));
      if (!payment) return;

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
          and(eq(customers.id, payment.customerId), eq(customers.tenantId, ctx.tenant.tenantId))
        );
      if (!customer) return;
      if (customer.optOutWhatsapp && customer.optOutEmail) return;

      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const body = `Hi ${customer.displayName}, we've received your payment of Rs. ${payment.amount} (${payment.paymentMode}). Receipt: ${payment.paymentNumber}.`;

      const send = (channel: 'WHATSAPP' | 'EMAIL', extra: Record<string, string>) =>
        fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({
            tenantId: ctx.tenant.tenantId,
            eventType: 'PAYMENT_RECEIVED',
            channel,
            body,
            ...extra,
          }),
        }).catch((err) =>
          logger.warn({ err, paymentId, channel }, 'Payment-received notification delivery failed')
        );

      if (!customer.optOutWhatsapp && customer.phone) {
        await send('WHATSAPP', { recipientPhone: customer.phone });
      }
      if (!customer.optOutEmail && customer.email) {
        await send('EMAIL', {
          recipientEmail: customer.email,
          subject: `Payment received — ${payment.paymentNumber}`,
        });
      }
    } catch (err) {
      logger.warn({ err, paymentId }, 'Payment-received notification failed (non-fatal)');
    }
  }
}
