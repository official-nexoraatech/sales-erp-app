import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import {
  PlatformContextFactory,
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  initializeTelemetry,
  initTenantStatusEnforcement,
  registerErrorHandler,
} from '@erp/sdk';
import {
  createLogger,
  createMetricsHandler,
  erpHttpRequestTotal,
  erpHttpErrorTotal,
  erpHttpRequestDuration,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import { dltTemplateRoutes } from './api/dlt-template.routes.js';
import { territoryRoutes } from './api/territory.routes.js';
import { fieldVisitRoutes } from './api/field-visit.routes.js';
import { healthScoringRoutes } from './api/health-scoring.routes.js';
import { loyaltyRoutes } from './api/loyalty.routes.js';
import { festivalIntelligenceRoutes } from './api/festival-intelligence.routes.js';
import { campaignRoutes } from './api/campaign.routes.js';
import { journeyRoutes } from './api/journey.routes.js';
import { quotaRoutes } from './api/quota.routes.js';
import { crmDashboardRoutes } from './api/crm-dashboard.routes.js';
import { accountRoutes } from './api/account.routes.js';
import { leadRoutes } from './api/lead.routes.js';
import { linkTrackingRoutes } from './api/link-tracking.routes.js';
import { conversationRoutes } from './api/conversation.routes.js';
import { callRoutes } from './api/call.routes.js';
import { inboundWebhookRoutes } from './api/inbound-webhooks.routes.js';
import { opportunityRoutes } from './api/opportunity.routes.js';
import { apiKeyRoutes } from './api/api-key.routes.js';
import { publicApiRoutes } from './api/public-api.routes.js';
import { referralRoutes } from './api/referral.routes.js';
import { referralPublicRoutes } from './api/referral-public.routes.js';
import { ticketRoutes } from './api/ticket.routes.js';
import { portalRoutes } from './api/portal.routes.js';
import { internalRoutes } from './api/internal.routes.js';

// Multi-vertical platform audit 2026-08-16, Phase 3 — scaffold for the CRM/Order-to-Cash
// split. sales-service's CRM-domain routes/services (leads, opportunities, campaigns,
// journeys, territories, quotas, tickets, conversations, referrals, field visits, CTI,
// public CRM/BI API) move here incrementally; O2C (invoices, quotations, payments, POS,
// sale returns, commission) stays in sales-service. dlt-template.routes.ts,
// territory.routes.ts, and field-visit.routes.ts are the first three migrated files.
// health-scoring.routes.ts is the fourth — only the cache-read half of HealthScoringService;
// its O2C-computing half stays in sales-service (see domain/HealthScoringService.ts's header
// comment) and reaches this service's internal.routes.ts over HTTP. The rest land the same
// way — mirrors sales-service/src/main.ts's bootstrap shape.
initializeTelemetry({ serviceName: 'crm-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['CRM_SERVICE_PORT'] ?? '3026', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'crm-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const metricsHandler = await createMetricsHandler('crm-service');

  const config = await loadConfigWithSecrets('crm-service');
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'crm-service',
    serviceName: 'crm-service',
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

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'crm-service', logger);

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

  registerHealthRoute(fastify, 'crm-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    const route = request.routeOptions?.url ?? request.url;
    const status = String(reply.statusCode);
    erpHttpRequestTotal.inc({ method, route, status_code: status });
    erpHttpRequestDuration.observe(
      { method, route, status_code: status, service: 'crm-service' },
      reply.elapsedTime / 1000
    );
    if (reply.statusCode >= 500) {
      erpHttpErrorTotal.inc({ method, route });
    }
  });

  // Registered as a true sibling of the authenticated `sub` block below, not nested inside
  // it — mirrors sales-service/main.ts's internalSub block exactly, which exists specifically
  // so internal routes don't inherit the authenticated block's `authenticate` preHandler hook
  // (that block calls fastify.addHook('preHandler', authenticate) directly on its own `sub`
  // instance, and nested registration would silently inherit it, 401ing every internal call).
  await fastify.register(
    async (internalSub) => {
      await internalRoutes(internalSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  await fastify.register(
    async (sub) => {
      await dltTemplateRoutes(sub, ctxFactory);
      await territoryRoutes(sub, ctxFactory);
      await fieldVisitRoutes(sub, ctxFactory);
      await healthScoringRoutes(sub, ctxFactory);
      await loyaltyRoutes(sub, ctxFactory);
      await festivalIntelligenceRoutes(sub, ctxFactory);
      await campaignRoutes(sub, ctxFactory);
      await journeyRoutes(sub, ctxFactory);
      await quotaRoutes(sub, ctxFactory);
      await crmDashboardRoutes(sub, ctxFactory);
      await accountRoutes(sub, ctxFactory);
      // POST /leads/capture and GET /c/:trackingToken (below) are public/unauthenticated —
      // safe to nest in this same `sub` block since, unlike sales-service's main.ts, nothing
      // here calls fastify.addHook('preHandler', authenticate) on `sub` itself; every route in
      // this file (including these two) gates itself via its own per-route preHandler array.
      await leadRoutes(sub, ctxFactory);
      await linkTrackingRoutes(sub, ctxFactory);
      await conversationRoutes(sub, ctxFactory);
      await callRoutes(sub, ctxFactory);
      // Inbound WhatsApp/email/SMS webhook routes are also public/unauthenticated (a provider
      // posting a reply isn't a logged-in ERP user) — safe to nest here for the same reason
      // leadRoutes/linkTrackingRoutes are (no file-level addHook on this `sub` to leak).
      await inboundWebhookRoutes(sub, ctxFactory);
      await opportunityRoutes(sub, ctxFactory);
      await apiKeyRoutes(sub, ctxFactory);
      // Public CRM API routes authenticate via their own requirePublicApiScope preHandler
      // (a per-tenant API key, never the staff `authenticate` hook) — safe to nest here for
      // the same reason leadRoutes/inboundWebhookRoutes are (no file-level addHook to leak).
      await publicApiRoutes(sub, ctxFactory.rawDb);
      await referralRoutes(sub, ctxFactory);
      // GET /r/:code and POST /referral/redeem are public/unauthenticated (a referee clicking
      // a shared link or redeeming a code isn't logged in) — safe to nest here, same reasoning
      // as every other public route file in this block.
      await referralPublicRoutes(sub, ctxFactory);
      await ticketRoutes(sub, ctxFactory);
      // Customer Portal ticket/referral routes gate via their own requirePortalAuth preHandler
      // (a CUSTOMER-role JWT, never the staff `authenticate` hook) — safe to nest here too.
      await portalRoutes(sub, ctxFactory.rawDb);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'CRM service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
