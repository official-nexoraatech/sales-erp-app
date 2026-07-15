import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { notificationLog, notificationDeliveryEvents, outboxEvents } from '@erp/db';
import { eq, like } from 'drizzle-orm';
import { ulid } from 'ulid';
import { createLogger } from '@erp/logger';
import type { NotificationServiceConfig } from '../config.js';
import {
  verifyMetaSignature,
  verifySendGridSignature,
  verifyMsg91Token,
  verifySharedSecret,
} from '../domain/webhookVerification.js';

const logger = createLogger({ serviceName: 'notification-service' });

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

type DeliveryStatus = 'DELIVERED' | 'FAILED';

// CP-6 (Campaign Management Platform initiative): delivery-status webhook receivers for the 3
// channel providers. Every route: (1) verifies the provider's signature over the RAW request
// body — never the parsed/re-serialized JSON, which can differ byte-for-byte from what was
// signed, (2) records a source-level idempotency row before applying any state change (NFR-09 —
// a provider redelivering the same event must not double-count), (3) updates notification_log,
// (4) writes a domain event to the outbox for sales-service's consumer to sync
// campaign_recipients/campaigns.deliveredCount (see consumers/NotificationDeliveryConsumer.ts in
// apps/sales-service). This route file is public-facing (no user JWT) — signature verification
// is the ONLY thing standing between this endpoint and an attacker forging delivery data; see
// 20_RISK_ASSESSMENT.md R3.

// Exported for direct integration testing (real-DB idempotency + status-update behavior) without
// needing a full HTTP-level Fastify harness for the raw-body content-type parser — see
// __tests__/webhook-delivery.test.ts.
export async function recordDeliveryEvent(
  db: ErpDatabase,
  tenantId: number,
  notificationLogId: number,
  provider: 'MSG91' | 'SENDGRID' | 'META',
  providerEventId: string,
  eventType: string
): Promise<boolean> {
  const [inserted] = await db
    .insert(notificationDeliveryEvents)
    .values({ tenantId, notificationLogId, provider, providerEventId, eventType })
    .onConflictDoNothing({
      target: [notificationDeliveryEvents.provider, notificationDeliveryEvents.providerEventId],
    })
    .returning();
  return !!inserted;
}

export async function applyDeliveryUpdate(
  db: ErpDatabase,
  logRow: { id: number; tenantId: number; deliveredAt: Date | null },
  status: DeliveryStatus,
  errorMessage: string | undefined
): Promise<void> {
  await db
    .update(notificationLog)
    .set({
      status,
      deliveredAt: status === 'DELIVERED' ? new Date() : logRow.deliveredAt,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      updatedAt: new Date(),
    })
    .where(eq(notificationLog.id, logRow.id));

  // Direct outbox insert (the "majority pattern" for this codebase — see
  // apps/purchase-service/src/domain/GRNService.ts) rather than ctx.events.publish(), since
  // notification-service does not construct a PlatformContext for its routes.
  await db.insert(outboxEvents).values({
    eventId: ulid(),
    eventType: 'NOTIFICATION_DELIVERY_UPDATED',
    aggregateType: 'notification_log',
    aggregateId: logRow.id,
    tenantId: logRow.tenantId,
    payload: { notificationLogId: logRow.id, status, errorMessage: errorMessage ?? null },
  });
}

export async function webhookRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: NotificationServiceConfig
): Promise<void> {
  // Raw-body capture, scoped to this plugin only via Fastify's encapsulation model — every other
  // route in this service keeps using Fastify's default JSON body parsing untouched.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as RequestWithRawBody).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(null, {});
    }
  });

  // ── MSG91 delivery report ─────────────────────────────────────────────
  // MSG91's DLR callback has no cryptographic signature scheme — verified via a shared-secret
  // token (see webhookVerification.ts). Payload shape: a single report object or an array of
  // them, each carrying the requestId returned when the SMS was sent (matches
  // notification_log.external_message_id) and a delivery status string.
  fastify.post('/webhooks/msg91/dlr', async (request, reply) => {
    const token =
      (request.headers['x-webhook-token'] as string | undefined) ??
      (request.query as Record<string, string | undefined>)['token'];
    if (!verifyMsg91Token(token, config.msg91WebhookSecret)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token' } });
    }

    const body = request.body as
      { requestId?: string; status?: string } | Array<{ requestId?: string; status?: string }>;
    const reports = Array.isArray(body) ? body : [body];

    let processed = 0;
    for (const report of reports) {
      if (!report.requestId || !report.status) continue;
      const [logRow] = await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.externalMessageId, report.requestId));
      if (!logRow) {
        logger.warn(
          { provider: 'MSG91', requestId: report.requestId },
          'Delivery webhook for unknown notification_log — ignored'
        );
        continue;
      }

      const statusUpper = report.status.toUpperCase();
      const status: DeliveryStatus | null =
        statusUpper === 'DELIVERED' ? 'DELIVERED' : statusUpper === 'FAILED' ? 'FAILED' : null;
      if (!status) continue;

      const isNew = await recordDeliveryEvent(
        db,
        logRow.tenantId,
        logRow.id,
        'MSG91',
        `${report.requestId}:${statusUpper}`,
        statusUpper
      );
      if (!isNew) continue;

      await applyDeliveryUpdate(
        db,
        logRow,
        status,
        status === 'FAILED' ? 'MSG91 reported delivery failure' : undefined
      );
      processed++;
    }

    return reply.code(200).send({ data: { processed } });
  });

  // ── SendGrid Event Webhook ────────────────────────────────────────────
  // Real Ed25519 "Signed Event Webhook" verification. Payload is a JSON array of event objects.
  // sg_message_id's exact suffix can differ from what SendGrid's send-time response header
  // returned (a known SendGrid quirk) — matched via a prefix LIKE rather than an exact equals.
  fastify.post('/webhooks/sendgrid/events', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const signature = request.headers['x-twilio-email-event-webhook-signature'] as
      string | undefined;
    const timestamp = request.headers['x-twilio-email-event-webhook-timestamp'] as
      string | undefined;
    if (!verifySendGridSignature(rawBody, signature, timestamp, config.sendgridWebhookPublicKey)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const events = request.body as Array<{
      event?: string;
      sg_message_id?: string;
      sg_event_id?: string;
    }>;
    let processed = 0;
    for (const event of events) {
      if (!event.sg_message_id || !event.sg_event_id) continue;
      const messageIdPrefix = event.sg_message_id.split('.')[0];
      if (!messageIdPrefix) continue;
      const [logRow] = await db
        .select()
        .from(notificationLog)
        .where(like(notificationLog.externalMessageId, `${messageIdPrefix}%`));
      if (!logRow) continue;

      const status: DeliveryStatus | null =
        event.event === 'delivered'
          ? 'DELIVERED'
          : event.event === 'bounce' || event.event === 'dropped'
            ? 'FAILED'
            : null;
      if (!status) continue;

      const isNew = await recordDeliveryEvent(
        db,
        logRow.tenantId,
        logRow.id,
        'SENDGRID',
        event.sg_event_id,
        event.event ?? 'unknown'
      );
      if (!isNew) continue;

      await applyDeliveryUpdate(
        db,
        logRow,
        status,
        status === 'FAILED' ? `SendGrid reported ${event.event}` : undefined
      );
      processed++;
    }

    return reply.code(200).send({ data: { processed } });
  });

  // ── Meta WhatsApp Cloud API status webhook ────────────────────────────
  // Real HMAC-SHA256 X-Hub-Signature-256 verification (Meta's actual webhook security scheme).
  fastify.post('/webhooks/whatsapp/status', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!verifyMetaSignature(rawBody, signature, config.whatsappAppSecret)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const body = request.body as {
      entry?: Array<{
        changes?: Array<{
          value?: { statuses?: Array<{ id?: string; status?: string; timestamp?: string }> };
        }>;
      }>;
    };
    const statuses = (body.entry ?? []).flatMap((e) =>
      (e.changes ?? []).flatMap((c) => c.value?.statuses ?? [])
    );

    let processed = 0;
    for (const s of statuses) {
      if (!s.id || !s.status) continue;
      const [logRow] = await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.externalMessageId, s.id));
      if (!logRow) continue;

      const statusUpper = s.status.toUpperCase();
      const status: DeliveryStatus | null =
        statusUpper === 'DELIVERED' || statusUpper === 'READ'
          ? 'DELIVERED'
          : statusUpper === 'FAILED'
            ? 'FAILED'
            : null;
      if (!status) continue;

      const isNew = await recordDeliveryEvent(
        db,
        logRow.tenantId,
        logRow.id,
        'META',
        `${s.id}:${statusUpper}:${s.timestamp ?? ''}`,
        statusUpper
      );
      if (!isNew) continue;

      await applyDeliveryUpdate(
        db,
        logRow,
        status,
        status === 'FAILED' ? 'WhatsApp reported delivery failure' : undefined
      );
      processed++;
    }

    return reply.code(200).send({ data: { processed } });
  });

  // Meta requires a GET verification handshake on webhook registration
  // (hub.mode/hub.verify_token/hub.challenge) — separate from the signed POST callbacks above.
  // Only echoes the challenge back when hub.verify_token matches the configured secret;
  // otherwise rejects, so an attacker can't use this endpoint to probe/confirm the webhook URL.
  fastify.get('/webhooks/whatsapp/status', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (!verifySharedSecret(verifyToken, config.whatsappWebhookVerifyToken)) {
      return reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: 'Invalid verify token' } });
    }
    if (!challenge) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Missing hub.challenge' } });
    }
    return reply.code(200).send(challenge);
  });
}
