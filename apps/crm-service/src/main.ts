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

// Multi-vertical platform audit 2026-08-16, Phase 3 — scaffold for the CRM/Order-to-Cash
// split. sales-service's CRM-domain routes/services (leads, opportunities, campaigns,
// journeys, territories, quotas, tickets, conversations, referrals, field visits, CTI,
// public CRM/BI API) move here incrementally; O2C (invoices, quotations, payments, POS,
// sale returns, commission) stays in sales-service. No routes are registered yet — this is
// the bare, deployable skeleton (mirrors sales-service/src/main.ts's bootstrap shape) that
// the actual domain-file migration lands on top of.
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

  // TODO(crm-service migration): CRM route registrations land here as domain files move
  // from sales-service — see ARCHITECTURE_AUDIT notes on route ownership split.

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'CRM service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
