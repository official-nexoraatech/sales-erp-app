import { eq, and } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { withTenantConnection } from '@erp/sdk';
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
   *
   * Phase 9 GUC-per-request rollout, RLS-readiness follow-up (2026-08-22): takes the raw pooled
   * db + tenantId directly instead of a caller-supplied PlatformContext, because this method's
   * own two SELECTs need to run inside their own withTenantConnection wrap (caveat 4g) — the
   * real fetch() calls below must stay outside any transaction, and by the time they run any ctx
   * the caller built for its own DB work has already committed and can't be reused.
   */
  static async notifyPaymentReceived(
    rawDb: ErpDatabase,
    tenantId: number,
    paymentId: number
  ): Promise<void> {
    try {
      const found = await withTenantConnection(rawDb, tenantId, async (scopedDb) => {
        const [payment] = await scopedDb
          .select({
            paymentNumber: payments.paymentNumber,
            amount: payments.amount,
            paymentMode: payments.paymentMode,
            customerId: payments.customerId,
          })
          .from(payments)
          .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));
        if (!payment) return null;

        const [customer] = await scopedDb
          .select({
            displayName: customers.displayName,
            phone: customers.phone,
            email: customers.email,
            optOutWhatsapp: customers.optOutWhatsapp,
            optOutEmail: customers.optOutEmail,
          })
          .from(customers)
          .where(and(eq(customers.id, payment.customerId), eq(customers.tenantId, tenantId)));
        if (!customer) return null;
        if (customer.optOutWhatsapp && customer.optOutEmail) return null;

        return { payment, customer };
      });
      if (!found) return;
      const { payment, customer } = found;

      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const body = `Hi ${customer.displayName}, we've received your payment of Rs. ${payment.amount} (${payment.paymentMode}). Receipt: ${payment.paymentNumber}.`;

      const send = (channel: 'WHATSAPP' | 'EMAIL', extra: Record<string, string>) =>
        fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({
            tenantId,
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
