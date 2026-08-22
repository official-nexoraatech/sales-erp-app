/* global process, fetch */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { createLogger } from '@erp/logger';
import { BillingService } from '../domain/BillingService.js';
import { createConfiguredGatewayAdapter } from '../domain/RazorpayGatewayAdapter.js';
import { erpTenantInvoiceGeneratedTotal, erpTenantPaymentFailedTotal } from '@erp/logger';

const logger = createLogger({ serviceName: 'tenant-service' });

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

async function notifyRaw(
  tenantId: number,
  eventType: string,
  subject: string,
  body: string
): Promise<void> {
  const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
  const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
  try {
    await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      body: JSON.stringify({ tenantId, eventType, channel: 'EMAIL', subject, body }),
    });
  } catch (err) {
    logger.warn({ tenantId, eventType, err }, 'Billing notification send failed (non-fatal)');
  }
}

// POST /internal/billing/run-cycle — the daily tenant-billing-cycle scheduler job's target.
// Platform-level (iterates all due tenants itself), not tenant-scoped — mirrors the
// x-internal-key convention every other internal.routes.ts file in this codebase uses.
export async function billingInternalRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post(
    '/internal/billing/run-cycle',
    { preHandler: checkInternalKey },
    async (_req, reply) => {
      const billingService = new BillingService(db);
      const gatewayAdapter = createConfiguredGatewayAdapter();
      const dueTenants = await billingService.findTenantsDueForBilling();

      let invoicesGenerated = 0;
      let paymentsFailed = 0;
      let suspended = 0;

      for (const { id: tenantId } of dueTenants) {
        try {
          const invoiceId = await billingService.generateInvoice(tenantId);
          if (invoiceId === null) continue; // unpriced plan — skipped, not an error

          invoicesGenerated += 1;
          erpTenantInvoiceGeneratedTotal.inc();

          const outcome = await billingService.chargeInvoice(invoiceId, gatewayAdapter);
          if (outcome === 'PAID') continue;

          paymentsFailed += 1;
          erpTenantPaymentFailedTotal.inc({ reason: outcome });
          await notifyRaw(
            tenantId,
            'TENANT_PAYMENT_FAILED',
            'Payment failed for your subscription',
            'We were unable to process your subscription payment. Please update your payment method to avoid service interruption.'
          );

          const dunning = await billingService.startOrCheckDunning(tenantId);
          if (dunning.action === 'GRACE_ELAPSED') {
            const didSuspend = await billingService.suspendForNonPayment(tenantId, ctxFactory);
            if (didSuspend) {
              suspended += 1;
              await notifyRaw(
                tenantId,
                'TENANT_SUBSCRIPTION_SUSPENDED',
                'Your subscription has been suspended',
                'Your account has been suspended due to non-payment. Please contact support to reactivate.'
              );
            }
          }
        } catch (err) {
          // One tenant's billing failure must never abort the whole cycle for every other tenant.
          logger.error({ tenantId, err }, 'Billing cycle failed for tenant');
        }
      }

      logger.info(
        { tenantsProcessed: dueTenants.length, invoicesGenerated, paymentsFailed, suspended },
        'Billing cycle run complete'
      );
      return reply
        .code(200)
        .send({
          data: {
            tenantsProcessed: dueTenants.length,
            invoicesGenerated,
            paymentsFailed,
            suspended,
          },
        });
    }
  );
}
