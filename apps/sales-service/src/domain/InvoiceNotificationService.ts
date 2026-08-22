import { eq, and } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { withTenantConnection } from '@erp/sdk';
import { invoices, customers } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'sales-service' });

export class InvoiceNotificationService {
  /**
   * Best-effort WhatsApp/Email notice to the customer once an invoice is confirmed — ES-18.
   * Never throws: a notification-service outage must not block invoice confirmation.
   *
   * Phase 9 GUC-per-request rollout, RLS-readiness follow-up (2026-08-22): takes the raw pooled
   * db + tenantId directly instead of a caller-supplied PlatformContext, because this method's
   * own two SELECTs need to run inside their own withTenantConnection wrap (caveat 4g) — the
   * real fetch() calls below must stay outside any transaction, and by the time they run any
   * ctx the caller built for its own DB work has already committed and can't be reused.
   */
  static async notifyInvoiceConfirmed(
    rawDb: ErpDatabase,
    tenantId: number,
    invoiceId: number
  ): Promise<void> {
    try {
      const found = await withTenantConnection(rawDb, tenantId, async (scopedDb) => {
        const [invoice] = await scopedDb
          .select({
            invoiceNumber: invoices.invoiceNumber,
            grandTotal: invoices.grandTotal,
            dueDate: invoices.dueDate,
            customerId: invoices.customerId,
          })
          .from(invoices)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
        if (!invoice) return null;

        const [customer] = await scopedDb
          .select({
            displayName: customers.displayName,
            phone: customers.phone,
            email: customers.email,
            optOutWhatsapp: customers.optOutWhatsapp,
            optOutEmail: customers.optOutEmail,
          })
          .from(customers)
          .where(and(eq(customers.id, invoice.customerId), eq(customers.tenantId, tenantId)));
        if (!customer) return null;
        if (customer.optOutWhatsapp && customer.optOutEmail) return null;

        return { invoice, customer };
      });
      if (!found) return;
      const { invoice, customer } = found;

      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const dueDateStr = invoice.dueDate.toISOString().slice(0, 10);
      const body = `Hi ${customer.displayName}, your invoice ${invoice.invoiceNumber} for Rs. ${invoice.grandTotal} is confirmed. Due by ${dueDateStr}.`;

      const send = (channel: 'WHATSAPP' | 'EMAIL', extra: Record<string, string>) =>
        fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({
            tenantId,
            eventType: 'INVOICE_CONFIRMED',
            channel,
            body,
            entityType: 'Invoice',
            entityId: invoiceId,
            businessCategory: 'SALES',
            ...extra,
          }),
        }).catch((err) =>
          logger.warn({ err, invoiceId, channel }, 'Invoice-confirmed notification delivery failed')
        );

      if (!customer.optOutWhatsapp && customer.phone) {
        await send('WHATSAPP', { recipientPhone: customer.phone });
      }
      if (!customer.optOutEmail && customer.email) {
        await send('EMAIL', {
          recipientEmail: customer.email,
          subject: `Invoice ${invoice.invoiceNumber} confirmed`,
        });
      }
    } catch (err) {
      logger.warn({ err, invoiceId }, 'Invoice-confirmed notification failed (non-fatal)');
    }
  }
}
