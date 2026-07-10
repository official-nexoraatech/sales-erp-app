import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY, registerHealthRoute, tenantOrIpKeyGenerator, initializeTelemetry, initTenantStatusEnforcement } from '@erp/sdk';
import { createLogger, createMetricsHandler, createHttpMetricsHook, createCorrelationIdHook } from '@erp/logger';
import { ERPError } from '@erp/types';
import { loadConfigWithSecrets } from '@erp/config';
import { warehouseRoutes } from './api/warehouse.routes.js';
import { categoryRoutes } from './api/category.routes.js';
import { brandRoutes } from './api/brand.routes.js';
import { unitRoutes } from './api/unit.routes.js';
import { itemRoutes } from './api/item.routes.js';
import { stockRoutes } from './api/stock.routes.js';
import { reservationRoutes } from './api/reservation.routes.js';
import { transferRoutes } from './api/transfer.routes.js';
import { adjustmentRoutes } from './api/adjustment.routes.js';
import { physicalVerificationRoutes } from './api/physical-verification.routes.js';
import { fabricRollRoutes } from './api/fabric-roll.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { valuationRoutes } from './api/valuation.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';
import { syncRoutes } from './api/sync.routes.js';

initializeTelemetry({ serviceName: 'inventory-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['INVENTORY_SERVICE_PORT'] ?? '3012', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({ serviceName: 'inventory-service', level: 'info', ...(lokiUrl ? { lokiUrl } : {}) });

  const config = await loadConfigWithSecrets('inventory-service');
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'inventory-service',
    serviceName: 'inventory-service',
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  const metricsHandler = await createMetricsHandler('inventory-service');

  const fastify = Fastify({ logger: false, trustProxy: true });

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
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
  fastify.addHook('onResponse', createHttpMetricsHook('inventory-service'));

  registerHealthRoute(fastify, 'inventory-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  await fastify.register(async (sub) => {
    await warehouseRoutes(sub, ctxFactory);
    await categoryRoutes(sub, ctxFactory);
    await brandRoutes(sub, ctxFactory);
    await unitRoutes(sub, ctxFactory);
    await itemRoutes(sub, ctxFactory);
    await stockRoutes(sub, ctxFactory);
    await reservationRoutes(sub, ctxFactory);
    await transferRoutes(sub, ctxFactory);
    await adjustmentRoutes(sub, ctxFactory);
    await physicalVerificationRoutes(sub, ctxFactory);
    await fabricRollRoutes(sub, ctxFactory);
    await internalRoutes(sub, ctxFactory);
    await valuationRoutes(sub, ctxFactory);
    await searchSyncInternalRoutes(sub, ctxFactory);
    await syncRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url, correlationId: (request as { correlationId?: string }).correlationId }, 'Unhandled error in inventory-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Inventory service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
