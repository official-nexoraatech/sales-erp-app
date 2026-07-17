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
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import { purchaseOrderRoutes } from './api/purchase-order.routes.js';
import { grnRoutes } from './api/grn.routes.js';
import { landedCostRoutes } from './api/landed-cost.routes.js';
import { supplierPaymentRoutes } from './api/supplier-payment.routes.js';
import { purchaseReturnRoutes } from './api/purchase-return.routes.js';
import { expenseRoutes } from './api/expense.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { attachmentRoutes } from './api/attachment.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';

initializeTelemetry({ serviceName: 'purchase-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['PURCHASE_SERVICE_PORT'] ?? '3020', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'purchase-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const config = await loadConfigWithSecrets('purchase-service');
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'purchase-service',
    serviceName: 'purchase-service',
    storage: {
      endpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
      accessKeyId: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
      secretAccessKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin123',
      useSSL: process.env['MINIO_USE_SSL'] === 'true',
      bucket: process.env['MINIO_BUCKET'] ?? 'erp-local',
    },
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  ctxFactory.subscribeTenantStatusInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  const metricsHandler = await createMetricsHandler('purchase-service');

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'purchase-service', logger);

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
  fastify.addHook('onResponse', createHttpMetricsHook('purchase-service'));

  registerHealthRoute(fastify, 'purchase-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // Internal-key-guarded routes (scheduler/service-to-service callers, checked via
  // x-internal-key, never a JWT) — registered as their own top-level, genuinely sibling
  // .register() call, never nested inside (or after) the block below. Found live
  // 2026-07-17 (same bug in sales-service's main.ts): several route files below
  // (purchaseOrderRoutes, grnRoutes, attachmentRoutes, ...) call
  // fastify.addHook('preHandler', authenticate) directly on the shared `sub` instance
  // they're given. A Fastify child only escapes a parent's hooks by being a true sibling
  // at the same encapsulation level — nesting a child inside that same `sub` does NOT
  // protect it regardless of source order, because avvio finalizes a parent's full hook
  // chain before any of its children boot (see sales-service's
  // src/__tests__/internal-route-auth-isolation.test.ts, same root cause). The old code
  // registered these routes directly on `sub` below, so they silently inherited every one
  // of those hooks — 401ing every scheduled search-sync/reindex call for every entity,
  // every tenant.
  await fastify.register(
    async (internalSub) => {
      await internalRoutes(internalSub, ctxFactory);
      await searchSyncInternalRoutes(internalSub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  await fastify.register(
    async (sub) => {
      await purchaseOrderRoutes(sub, ctxFactory);
      await grnRoutes(sub, ctxFactory);
      await landedCostRoutes(sub, ctxFactory);
      await supplierPaymentRoutes(sub, ctxFactory);
      await purchaseReturnRoutes(sub, ctxFactory);
      await expenseRoutes(sub, ctxFactory);
      await attachmentRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Purchase service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
