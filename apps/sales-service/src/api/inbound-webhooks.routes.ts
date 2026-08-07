import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ConversationService } from '../domain/ConversationService.js';
import { CallService, loadTwilioConfig, type TwilioStatus } from '../domain/CallService.js';
import { WhatsAppCommerceService } from '../domain/WhatsAppCommerceService.js';
import {
  verifyMetaSignature,
  verifySharedSecret,
  verifyInboundHmacSignature,
  verifyTwilioSignature,
} from '../domain/inboundWebhookVerification.js';

const logger = createLogger({ serviceName: 'sales-service' });

// CRM-ROADMAP Phase 2, Feature 5 — Omnichannel Communication Hub.
//
// Every route here is PUBLIC (no `authenticate` preHandler) by necessity — a WhatsApp/SMS/email
// provider posting an inbound reply isn't a logged-in ERP user. Per 06-SECURITY-PLAN.md §2.2:
// verified by provider signature (never a shared secret alone, mirroring how
// WebhookDispatchService already signs OUTBOUND deliveries, applied here in reverse), and
// idempotent per-message (ConversationService.recordInboundMessage's own dedup key), same
// discipline as notification-service's delivery-status webhooks (CP-6). Every handler writes and
// acks fast — heavier processing has nowhere to defer to yet in this pass, so payloads are kept
// small and processing stays a single insert/update per message.

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

export async function inboundWebhookRoutes(
  fastify: FastifyInstance,
  _ctxFactory: PlatformContextFactory
): Promise<void> {
  // Raw-body capture, scoped to this plugin only — every other route in this service keeps
  // using Fastify's default JSON body parsing untouched. Signature verification must run against
  // the RAW bytes, never the parsed/re-serialized JSON, which can differ byte-for-byte from what
  // the provider actually signed.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as RequestWithRawBody).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(null, {});
    }
  });

  // Twilio posts form-encoded webhooks, never JSON — its signature scheme is computed over the
  // parsed field map (see verifyTwilioSignature), not raw bytes, so parsing here (rather than
  // deferring to a raw-string capture like the JSON parser above) is both correct and sufficient.
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch {
        done(null, {});
      }
    }
  );

  // ── Meta WhatsApp Cloud API — inbound message webhook ────────────────────
  fastify.post('/webhooks/whatsapp', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!verifyMetaSignature(rawBody, signature, process.env['WHATSAPP_APP_SECRET'] ?? '')) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

    const body = request.body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            metadata?: { phone_number_id?: string; display_phone_number?: string };
            contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
            messages?: Array<{
              from?: string;
              id?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
              // CRM-ROADMAP Phase 4, Feature 2 — WhatsApp Commerce Cloud API's order message
              // shape (`type: 'order'`), distinct from the plain text messages already handled.
              order?: {
                catalog_id?: string;
                product_items?: Array<{
                  product_retailer_id?: string;
                  quantity?: number;
                  item_price?: number;
                }>;
              };
            }>;
          };
        }>;
      }>;
    };

    let processed = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const toAddress = value.metadata?.display_phone_number ?? value.metadata?.phone_number_id;
        if (!toAddress) continue;
        const tenantId = await ConversationService.resolveTenantByAddress(
          db,
          'WHATSAPP',
          toAddress
        );
        if (!tenantId) {
          logger.warn({ toAddress }, 'WhatsApp inbound webhook: no tenant sender identity matches');
          continue;
        }

        for (const msg of value.messages ?? []) {
          if (!msg.from || !msg.id) continue;
          const senderName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;

          if (msg.type === 'order' && msg.order?.product_items) {
            const productItems = msg.order.product_items
              .filter(
                (p) =>
                  p.product_retailer_id && p.quantity !== undefined && p.item_price !== undefined
              )
              .map((p) => ({
                productRetailerId: p.product_retailer_id!,
                quantity: p.quantity!,
                itemPrice: p.item_price!,
              }));
            if (productItems.length > 0) {
              await WhatsAppCommerceService.handleOrderMessage(db, tenantId, {
                waPhoneNumber: msg.from,
                senderName,
                waOrderMessageId: msg.id,
                ...(msg.order.catalog_id ? { catalogId: msg.order.catalog_id } : {}),
                productItems,
                rawPayload: msg as unknown as Record<string, unknown>,
              });
              processed++;
            }
            continue;
          }

          if (!msg.text?.body) continue;
          await ConversationService.recordInboundMessage(db, tenantId, {
            channel: 'WHATSAPP',
            externalAddress: msg.from,
            senderName,
            body: msg.text.body,
            provider: 'META',
            providerMessageId: msg.id,
          });
          processed++;
        }
      }
    }

    return reply.code(200).send({ data: { processed } });
  });

  // Meta requires a GET verification handshake on webhook registration
  // (hub.mode/hub.verify_token/hub.challenge) — separate from the signed POST callbacks above.
  fastify.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (
      !verifySharedSecret(
        query['hub.verify_token'],
        process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] ?? ''
      )
    ) {
      return reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: 'Invalid verify token' } });
    }
    if (!query['hub.challenge']) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Missing hub.challenge' } });
    }
    return reply.code(200).send(query['hub.challenge']);
  });

  // ── Instagram Messaging — inbound message webhook ─────────────────────────
  // Same Meta HMAC signature scheme as WhatsApp above, but Messenger-platform payload shape
  // (entry[].messaging[]) rather than WhatsApp Cloud API's entry[].changes[].value.messages[] —
  // Instagram Messaging and Messenger share the same webhook protocol.
  fastify.post('/webhooks/instagram', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!verifyMetaSignature(rawBody, signature, process.env['INSTAGRAM_APP_SECRET'] ?? '')) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

    const body = request.body as {
      entry?: Array<{
        id?: string;
        messaging?: Array<{
          sender?: { id?: string };
          message?: { mid?: string; text?: string; is_echo?: boolean };
        }>;
      }>;
    };

    let processed = 0;
    for (const entry of body.entry ?? []) {
      const toAddress = entry.id;
      if (!toAddress) continue;
      const tenantId = await ConversationService.resolveTenantByAddress(db, 'INSTAGRAM', toAddress);
      if (!tenantId) {
        logger.warn({ toAddress }, 'Instagram inbound webhook: no tenant sender identity matches');
        continue;
      }

      for (const msg of entry.messaging ?? []) {
        // is_echo marks a message this same business account sent (e.g. via the app itself,
        // outside this platform's own reply path) being echoed back — not a genuine inbound
        // message, and recording it would double-count an outbound send as an inbound reply.
        if (msg.message?.is_echo) continue;
        if (!msg.sender?.id || !msg.message?.mid || !msg.message.text) continue;

        await ConversationService.recordInboundMessage(db, tenantId, {
          channel: 'INSTAGRAM',
          externalAddress: msg.sender.id,
          body: msg.message.text,
          provider: 'META',
          providerMessageId: msg.message.mid,
        });
        processed++;
      }
    }

    return reply.code(200).send({ data: { processed } });
  });

  // Meta requires a GET verification handshake on webhook registration
  // (hub.mode/hub.verify_token/hub.challenge) — separate from the signed POST callback above.
  fastify.get('/webhooks/instagram', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (
      !verifySharedSecret(
        query['hub.verify_token'],
        process.env['INSTAGRAM_WEBHOOK_VERIFY_TOKEN'] ?? ''
      )
    ) {
      return reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: 'Invalid verify token' } });
    }
    if (!query['hub.challenge']) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Missing hub.challenge' } });
    }
    return reply.code(200).send(query['hub.challenge']);
  });

  // ── Email inbound-parse ───────────────────────────────────────────────────
  // Unlike Meta's fixed protocol above, this integration's payload shape and signature scheme
  // are ours to define — HMAC-SHA256-over-raw-body, the same scheme WebhookDispatchService
  // already uses for outbound deliveries, applied in reverse for consistency.
  fastify.post('/webhooks/email', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    if (
      !verifyInboundHmacSignature(
        rawBody,
        signature,
        process.env['EMAIL_INBOUND_WEBHOOK_SECRET'] ?? ''
      )
    ) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

    const body = request.body as {
      to?: string;
      from?: string;
      fromName?: string;
      text?: string;
      messageId?: string;
    };
    if (!body.to || !body.from || !body.text || !body.messageId) {
      return reply.code(200).send({ data: { processed: 0 } });
    }

    const tenantId = await ConversationService.resolveTenantByAddress(db, 'EMAIL', body.to);
    if (!tenantId) {
      logger.warn({ to: body.to }, 'Email inbound webhook: no tenant sender identity matches');
      return reply.code(200).send({ data: { processed: 0 } });
    }

    await ConversationService.recordInboundMessage(db, tenantId, {
      channel: 'EMAIL',
      externalAddress: body.from,
      senderName: body.fromName,
      body: body.text,
      provider: 'SENDGRID',
      providerMessageId: body.messageId,
    });

    return reply.code(200).send({ data: { processed: 1 } });
  });

  // ── SMS two-way ────────────────────────────────────────────────────────────
  fastify.post('/webhooks/sms', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    if (
      !verifyInboundHmacSignature(
        rawBody,
        signature,
        process.env['SMS_INBOUND_WEBHOOK_SECRET'] ?? ''
      )
    ) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

    const body = request.body as { to?: string; from?: string; body?: string; messageId?: string };
    if (!body.to || !body.from || !body.body || !body.messageId) {
      return reply.code(200).send({ data: { processed: 0 } });
    }

    const tenantId = await ConversationService.resolveTenantByAddress(db, 'SMS', body.to);
    if (!tenantId) {
      logger.warn({ to: body.to }, 'SMS inbound webhook: no tenant sender identity matches');
      return reply.code(200).send({ data: { processed: 0 } });
    }

    await ConversationService.recordInboundMessage(db, tenantId, {
      channel: 'SMS',
      externalAddress: body.from,
      body: body.body,
      provider: 'MSG91',
      providerMessageId: body.messageId,
    });

    return reply.code(200).send({ data: { processed: 1 } });
  });

  // ── Twilio CTI (CRM-ROADMAP Phase 4, Feature 7) ────────────────────────────
  // All three routes are verified via verifyTwilioSignature — Twilio's own HMAC-SHA1-over-URL-
  // plus-sorted-form-params scheme, computed against the exact public URL configured in the
  // Twilio console (TWILIO_*_WEBHOOK_URL env vars), never a URL reconstructed from the request
  // (see loadTwilioConfig's own comment on why that would silently break behind api-gateway).

  fastify.post('/webhooks/twilio/voice', async (request, reply) => {
    const config = loadTwilioConfig();
    const signature = request.headers['x-twilio-signature'] as string | undefined;
    const params = request.body as Record<string, string>;
    if (!verifyTwilioSignature(config.voiceWebhookUrl, params, signature, config.authToken)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    const customerNumber = (request.query as { customerNumber?: string }).customerNumber;
    if (!customerNumber) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Missing customerNumber' } });
    }
    return reply
      .code(200)
      .header('Content-Type', 'text/xml')
      .send(CallService.buildBridgeTwiml(customerNumber));
  });

  fastify.post('/webhooks/twilio/status', async (request, reply) => {
    const config = loadTwilioConfig();
    const signature = request.headers['x-twilio-signature'] as string | undefined;
    const params = request.body as Record<string, string>;
    if (!verifyTwilioSignature(config.statusWebhookUrl, params, signature, config.authToken)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    if (!params['CallSid'] || !params['CallStatus']) {
      return reply.code(200).send({ data: { processed: 0 } });
    }

    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    await CallService.handleStatusCallback(db, {
      callSid: params['CallSid'],
      status: params['CallStatus'] as TwilioStatus,
      ...(params['CallDuration'] ? { durationSeconds: parseInt(params['CallDuration'], 10) } : {}),
    });
    return reply.code(200).send({ data: { processed: 1 } });
  });

  fastify.post('/webhooks/twilio/recording', async (request, reply) => {
    const config = loadTwilioConfig();
    const signature = request.headers['x-twilio-signature'] as string | undefined;
    const params = request.body as Record<string, string>;
    if (!verifyTwilioSignature(config.recordingWebhookUrl, params, signature, config.authToken)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
    }

    if (!params['CallSid'] || !params['RecordingUrl']) {
      return reply.code(200).send({ data: { processed: 0 } });
    }

    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    await CallService.handleRecordingCallback(db, {
      callSid: params['CallSid'],
      recordingUrl: params['RecordingUrl'],
    });
    return reply.code(200).send({ data: { processed: 1 } });
  });
}
