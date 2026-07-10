import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY, registerHealthRoute, tenantOrIpKeyGenerator, initializeTelemetry, initTenantStatusEnforcement } from '@erp/sdk';
import { createLogger, createMetricsHandler, createHttpMetricsHook, createCorrelationIdHook } from '@erp/logger';
import { ERPError } from '@erp/types';
import { loadConfigWithSecrets } from '@erp/config';
import { jobWorkRoutes } from './api/job-work.routes.js';
import { barcodeRoutes } from './api/barcode.routes.js';
import { consignmentRoutes } from './api/consignment.routes.js';
import { reorderRoutes } from './api/reorder.routes.js';
import { schedulerInternalRoutes } from './api/internal.routes.js';

initializeTelemetry({ serviceName: 'production-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['PRODUCTION_SERVICE_PORT'] ?? '3022', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({ serviceName: 'production-service', level: 'info', ...(lokiUrl ? { lokiUrl } : {}) });

  const config = await loadConfigWithSecrets('production-service');
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'production-service',
    serviceName: 'production-service',
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  const metricsHandler = await createMetricsHandler('production-service');

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
  fastify.addHook('onResponse', createHttpMetricsHook('production-service'));

  registerHealthRoute(fastify, 'production-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  await fastify.register(async (sub) => {
    await jobWorkRoutes(sub, ctxFactory);
    await barcodeRoutes(sub, ctxFactory);
    await consignmentRoutes(sub, ctxFactory);
    await reorderRoutes(sub, ctxFactory);
    await schedulerInternalRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error.validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: error.validation },
      });
    }
    logger.error({ err: error.message, url: request.url, correlationId: (request as { correlationId?: string }).correlationId }, 'Unhandled error in production-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Production service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
