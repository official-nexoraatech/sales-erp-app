/* global crypto, setInterval */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Kafka } from 'kafkajs';
import {
  PlatformContextFactory,
  TenantScopedDatabase,
  type EventHandler,
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  initializeTelemetry,
  initTenantStatusEnforcement,
  registerErrorHandler,
} from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import {
  createLogger,
  createMetricsHandler,
  erpInvoiceCreateTotal,
  erpInvoiceCreateFailedTotal,
  erpHttpRequestTotal,
  erpHttpErrorTotal,
  erpHttpRequestDuration,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import { handleNotificationDeliveryUpdated } from './consumers/NotificationDeliveryConsumer.js';
import { WebhookDispatchWorker } from './domain/WebhookDispatchWorker.js';
import { customerRoutes } from './api/customer.routes.js';
import { supplierRoutes } from './api/supplier.routes.js';
import { quotationRoutes } from './api/quotation.routes.js';
import { invoiceRoutes } from './api/invoice.routes.js';
import { commissionRoutes } from './api/commission.routes.js';
import { posRoutes } from './api/pos.routes.js';
import { paymentRoutes } from './api/payment.routes.js';
import { saleReturnRoutes } from './api/sale-return.routes.js';
import { loyaltyRoutes } from './api/loyalty.routes.js';
import { deliveryChallanRoutes } from './api/delivery-challan.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { crmRoutes } from './api/crm.routes.js';
import { journeyRoutes } from './api/journey.routes.js';
import { referralRoutes } from './api/referral.routes.js';
import { referralPublicRoutes } from './api/referral-public.routes.js';
import { conversationRoutes } from './api/conversation.routes.js';
import { inboundWebhookRoutes } from './api/inbound-webhooks.routes.js';
import { accountRoutes } from './api/account.routes.js';
import { leadRoutes } from './api/lead.routes.js';
import { customer360Routes } from './api/customer-360.routes.js';
import { ticketRoutes } from './api/ticket.routes.js';
import { dltTemplateRoutes } from './api/dlt-template.routes.js';
import { crmDashboardRoutes } from './api/crm-dashboard.routes.js';
import { opportunityRoutes } from './api/opportunity.routes.js';
import { linkTrackingRoutes } from './api/link-tracking.routes.js';
import { integrationsRoutes } from './api/integrations.routes.js';
import { dashboardRoutes } from './api/dashboard.routes.js';
import { attachmentRoutes } from './api/attachment.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';
import { syncRoutes } from './api/sync.routes.js';
import { portalRoutes } from './api/portal.routes.js';
import { territoryRoutes } from './api/territory.routes.js';
import { quotaRoutes } from './api/quota.routes.js';
import { apiKeyRoutes } from './api/api-key.routes.js';
import { publicApiRoutes } from './api/public-api.routes.js';
import { fieldVisitRoutes } from './api/field-visit.routes.js';
import { callRoutes } from './api/call.routes.js';

initializeTelemetry({ serviceName: 'sales-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SALES_SERVICE_PORT'] ?? '3013', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'sales-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const metricsHandler = await createMetricsHandler('sales-service');

  const config = await loadConfigWithSecrets('sales-service');
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'sales-service',
    serviceName: 'sales-service',
    storage: {
      endpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
      accessKeyId: config.minioAccessKey,
      secretAccessKey: config.minioSecretKey,
      useSSL: process.env['MINIO_USE_SSL'] === 'true',
      bucket: process.env['MINIO_BUCKET'] ?? 'erp-local',
    },
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  ctxFactory.subscribeTenantStatusInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  // ── Kafka event consumers (CP-6: sales-service's first) ────────────────────
  // Syncs delivery-webhook outcomes from notification-service onto campaign_recipients — see
  // consumers/NotificationDeliveryConsumer.ts. Modeled directly on gst-service's main.ts, the
  // clearest existing example of a service's first Kafka consumer registration.
  const kafka = new Kafka({
    clientId: 'sales-service-consumer',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
  });
  const consumerDb = createDatabaseClient({ url: config.databaseUrl, maxConnections: 3 });

  const eventDispatcher: EventHandler = async (event, db) => {
    switch (event.eventType) {
      case 'NOTIFICATION_DELIVERY_UPDATED':
        await handleNotificationDeliveryUpdated(event, db);
        break;
      default:
        logger.warn(
          { eventType: event.eventType },
          'Unhandled event type in sales-service consumer'
        );
    }
  };

  const salesTopics = ['erp.notification.delivery.updated'];

  const { PlatformEventConsumer } = await import('@erp/sdk');
  const eventConsumer = new PlatformEventConsumer(kafka, 'sales-service-group', 'sales-service');
  await eventConsumer.subscribe(
    salesTopics,
    eventDispatcher,
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({}, 'Sales-service Kafka consumers started');

  // CP-8: outbound campaign-lifecycle webhook dispatcher — see WebhookDispatchWorker.ts. Reuses
  // the same dedicated consumerDb pool as the Kafka consumer above rather than opening a third
  // connection pool for what is, structurally, the same kind of background poll-worker.
  const webhookDispatchWorker = new WebhookDispatchWorker({ db: consumerDb });
  webhookDispatchWorker.start();

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'sales-service', logger);

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    methods: CORS_METHODS,
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    redis: ctxFactory.getRedis(),
    keyGenerator: tenantOrIpKeyGenerator,
  });

  registerHealthRoute(fastify, 'sales-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // PG-028: in-memory per-tenant API-call counter, flushed periodically as a single batched
  // usage_events row (USAGE_API_CALL_BATCH) rather than a write per request — a per-request
  // DB/Kafka write here would add unacceptable latency/load to every request in the system.
  const apiCallCounts = new Map<number, number>();
  const API_CALL_FLUSH_INTERVAL_MS = 60_000;
  const flushApiCallCounts = async (): Promise<void> => {
    const snapshot = new Map(apiCallCounts);
    apiCallCounts.clear();
    for (const [tenantId, count] of snapshot) {
      if (count <= 0) continue;
      try {
        const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
        await ctx.events.publish('usage', tenantId, 'USAGE_API_CALL_BATCH', {
          quantity: count,
          service: 'sales-service',
        });
      } catch (err) {
        logger.warn({ tenantId, err }, 'Failed to flush API-call usage batch (non-fatal)');
      }
    }
  };
  setInterval(() => {
    void flushApiCallCounts();
  }, API_CALL_FLUSH_INTERVAL_MS).unref();

  // Instrument every response for erp_http_request_total and erp_http_error_total
  fastify.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    const route = request.routeOptions?.url ?? request.url;
    const status = String(reply.statusCode);
    erpHttpRequestTotal.inc({ method, route, status_code: status });
    erpHttpRequestDuration.observe(
      { method, route, status_code: status, service: 'sales-service' },
      reply.elapsedTime / 1000
    );
    if (reply.statusCode >= 500) {
      erpHttpErrorTotal.inc({ method, route });
    }
    // Track invoice creations for the erp_invoice_create_total counter
    if (method === 'POST' && route === '/api/v2/invoices') {
      const tenantId = String(
        (request as { auth?: { tenantId?: number } }).auth?.tenantId ?? 'unknown'
      );
      if (reply.statusCode === 201) {
        erpInvoiceCreateTotal.inc({ tenant_id: tenantId, branch_id: 'unknown' });
      } else if (reply.statusCode >= 400) {
        erpInvoiceCreateFailedTotal.inc({ tenant_id: tenantId, reason: status });
      }
    }
    // PG-028: batched API-call usage counting — see flushApiCallCounts above.
    const authTenantId = (request as { auth?: { tenantId?: number } }).auth?.tenantId;
    if (authTenantId !== undefined) {
      apiCallCounts.set(authTenantId, (apiCallCounts.get(authTenantId) ?? 0) + 1);
    }
  });

  // Internal-key-guarded routes (scheduler/service-to-service callers, checked via
  // x-internal-key, never a JWT) — registered as their own top-level, genuinely sibling
  // .register() call, never nested inside (or after) the block below. Found live
  // 2026-07-17: several route files below (attachmentRoutes, quotationRoutes,
  // invoiceRoutes, paymentRoutes, ...) call fastify.addHook('preHandler', authenticate)
  // directly on the shared `sub` instance they're given. A Fastify child only escapes a
  // parent's hooks by being a true sibling at the same encapsulation level — nesting a
  // child inside that same `sub` does NOT protect it, even if the nested .register() call
  // is written before the addHook-adding calls in source order, because avvio finalizes a
  // parent's full hook chain before any of its children boot (confirmed by test:
  // src/__tests__/internal-route-auth-isolation.test.ts). The old code registered these
  // routes directly on `sub` below, so they silently inherited every one of those hooks —
  // 401ing every scheduled search-sync/reindex call for every entity, every tenant.
  await fastify.register(
    async (internalSub) => {
      await internalRoutes(internalSub, ctxFactory);
      await searchSyncInternalRoutes(internalSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  // CRM-ROADMAP Phase 1, Feature 2: POST /leads/capture is public/unauthenticated — it must
  // be a true sibling of the `sub` block below, not nested inside it, for the exact reason
  // documented on the internalSub block above (quotationRoutes/invoiceRoutes/etc. call
  // fastify.addHook('preHandler', authenticate) directly on that shared `sub` instance;
  // nesting leadRoutes inside it would silently 401 the one route in this file that must
  // never require a JWT). Its own per-route preHandler array still gates every other /leads
  // route with authenticate + requirePermission as normal.
  await fastify.register(
    async (leadSub) => {
      await leadRoutes(leadSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  // CRM-ROADMAP Phase 2, Feature 6: GET /c/:trackingToken and /o/:trackingToken are also
  // public/unauthenticated (a campaign recipient clicking a link or loading an email image
  // isn't logged in) — same sibling-registration requirement as leadRoutes above.
  await fastify.register(
    async (trackingSub) => {
      await linkTrackingRoutes(trackingSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  // CRM-ROADMAP Phase 2, Feature 4: GET /r/:code and POST /referral/redeem are also
  // public/unauthenticated (a referee clicking a shared link or redeeming a code isn't logged
  // in) — same sibling-registration requirement as leadRoutes/linkTrackingRoutes above.
  await fastify.register(
    async (referralPublicSub) => {
      await referralPublicRoutes(referralPublicSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  // CRM-ROADMAP Phase 2, Feature 5: the inbound WhatsApp/email/SMS webhooks are also
  // public/unauthenticated (a provider posting a reply isn't a logged-in ERP user) — same
  // sibling-registration requirement as every public route file above.
  await fastify.register(
    async (inboundWebhookSub) => {
      await inboundWebhookRoutes(inboundWebhookSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal): a CUSTOMER-role JWT, never
  // a staff one — every /portal/* route gates itself with its own requirePortalAuth preHandler,
  // never the staff `authenticate` hook. Same true-sibling-registration requirement as every
  // other public/differently-authed route block above (see internalSub's own comment for why).
  await fastify.register(
    async (portalSub) => {
      await portalRoutes(portalSub, ctxFactory.rawDb);
    },
    { prefix: '/api/v2' }
  );

  // CRM-ROADMAP Phase 4, Feature 8 (Public CRM API & BI Export): authenticated by a per-tenant
  // API key via its own requirePublicApiScope preHandler, never the staff `authenticate` hook —
  // same true-sibling-registration requirement as portalSub above (see internalSub's own
  // comment for why nesting would silently break this).
  await fastify.register(
    async (publicApiSub) => {
      await publicApiRoutes(publicApiSub, ctxFactory.rawDb);
    },
    { prefix: '/api/v2' }
  );

  await fastify.register(
    async (sub) => {
      await customerRoutes(sub, ctxFactory);
      await supplierRoutes(sub, ctxFactory);
      await quotationRoutes(sub, ctxFactory);
      await invoiceRoutes(sub, ctxFactory);
      await commissionRoutes(sub, ctxFactory);
      await posRoutes(sub, ctxFactory);
      await paymentRoutes(sub, ctxFactory);
      await saleReturnRoutes(sub, ctxFactory);
      await loyaltyRoutes(sub, ctxFactory);
      await deliveryChallanRoutes(sub, ctxFactory);
      await crmRoutes(sub, ctxFactory);
      await journeyRoutes(sub, ctxFactory);
      await referralRoutes(sub, ctxFactory);
      await conversationRoutes(sub, ctxFactory);
      await accountRoutes(sub, ctxFactory);
      await customer360Routes(sub, ctxFactory);
      await ticketRoutes(sub, ctxFactory);
      await dltTemplateRoutes(sub, ctxFactory);
      await crmDashboardRoutes(sub, ctxFactory);
      await opportunityRoutes(sub, ctxFactory);
      await integrationsRoutes(sub, ctxFactory);
      await dashboardRoutes(sub, ctxFactory);
      await attachmentRoutes(sub, ctxFactory);
      await syncRoutes(sub, ctxFactory);
      await territoryRoutes(sub, ctxFactory);
      await quotaRoutes(sub, ctxFactory);
      await apiKeyRoutes(sub, ctxFactory);
      await fieldVisitRoutes(sub, ctxFactory);
      await callRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Sales service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
