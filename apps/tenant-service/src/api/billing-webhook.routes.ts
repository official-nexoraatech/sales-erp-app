/* global process */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenantInvoices } from '@erp/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@erp/logger';
import { withTenantConnection } from '@erp/sdk';
import { verifyWebhookSignature } from '../domain/RazorpayGatewayAdapter.js';

const logger = createLogger({ serviceName: 'tenant-service' });

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
      };
    };
  };
}

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

// POST /billing/webhooks/razorpay — public (external caller, no x-internal-key), the one
// genuinely-external-facing surface this package introduces. Must verify Razorpay's own
// signature before trusting anything, unlike every other route in this file's sibling
// billing-internal.routes.ts (which trusts x-internal-key instead — that convention is for
// service-to-service calls within this monorepo's own trust boundary, not for an external
// provider webhook).
export async function billingWebhookRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  // Raw-body capture, scoped to this plugin only via Fastify's encapsulation model (mirrors
  // notification-service's webhookRoutes) — every other route in this service keeps using
  // Fastify's default JSON body parsing untouched.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as RequestWithRawBody).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(null, {});
    }
  });

  fastify.post('/billing/webhooks/razorpay', async (request: FastifyRequest, reply) => {
    const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET'] ?? '';
    const signature = request.headers['x-razorpay-signature'];
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';

    if (
      !verifyWebhookSignature(
        rawBody,
        typeof signature === 'string' ? signature : undefined,
        webhookSecret
      )
    ) {
      logger.warn(
        { hasSecret: !!webhookSecret },
        'Rejected Razorpay webhook with invalid signature'
      );
      return reply
        .code(401)
        .send({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } });
    }

    const body = request.body as RazorpayWebhookPayload;
    const paymentEntity = body.payload?.payment?.entity;

    // Tenant isn't known up front (this is a Razorpay-originated call, not one of this
    // service's own tenant-scoped requests) — look it up by paymentGatewayRef first, then
    // scope the actual update via withTenantConnection once the tenant is known (caveat 4f).
    if (body.event === 'payment.captured' && paymentEntity?.order_id) {
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const [invoice] = await db
        .select({ tenantId: tenantInvoices.tenantId })
        .from(tenantInvoices)
        .where(eq(tenantInvoices.paymentGatewayRef, orderId));
      if (invoice) {
        await withTenantConnection(db, invoice.tenantId, (scopedDb) =>
          scopedDb
            .update(tenantInvoices)
            .set({
              status: 'PAID',
              paymentGatewayRef: paymentId,
              paidAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(tenantInvoices.paymentGatewayRef, orderId))
        );
      }
      logger.info({ orderId }, 'Webhook: payment captured');
    } else if (body.event === 'payment.failed' && paymentEntity?.order_id) {
      const orderId = paymentEntity.order_id;
      const [invoice] = await db
        .select({ tenantId: tenantInvoices.tenantId })
        .from(tenantInvoices)
        .where(eq(tenantInvoices.paymentGatewayRef, orderId));
      if (invoice) {
        await withTenantConnection(db, invoice.tenantId, (scopedDb) =>
          scopedDb
            .update(tenantInvoices)
            .set({
              status: 'FAILED',
              failureReason: 'Webhook reported payment.failed',
              updatedAt: new Date(),
            })
            .where(eq(tenantInvoices.paymentGatewayRef, orderId))
        );
      }
      logger.info({ orderId }, 'Webhook: payment failed');
    } else {
      logger.info({ event: body.event }, 'Webhook: unhandled event type, acknowledged only');
    }

    return reply.code(200).send({ data: { received: true } });
  });
}
