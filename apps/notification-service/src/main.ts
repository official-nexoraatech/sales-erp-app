import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createDatabaseClient } from '@erp/db';
import { HELMET_OPTIONS, PERMISSIONS_POLICY, registerHealthRoute, tenantOrIpKeyGenerator, checkDatabase, initializeTelemetry, initTenantStatusEnforcement } from '@erp/sdk';
import { createLogger, createMetricsHandler, createHttpMetricsHook, createCorrelationIdHook } from '@erp/logger';
import { ERPError } from '@erp/types';
import { loadNotificationConfig } from './config.js';
import { notificationRoutes } from './api/notification.routes.js';

initializeTelemetry({ serviceName: 'notification-service' });

async function bootstrap(): Promise<void> {
  const config = await loadNotificationConfig();
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({ serviceName: 'notification-service', level: 'info', ...(lokiUrl ? { lokiUrl } : {}) });

  const db = createDatabaseClient({ url: config.databaseUrl });
  initTenantStatusEnforcement(db);
  const metricsHandler = await createMetricsHandler('notification-service');

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
  // No Redis connection in this service — in-memory rate-limit store (same fallback auth-service uses).
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('notification-service'));

  registerHealthRoute(fastify, 'notification-service', {
    db: () => checkDatabase(db),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // PG-010: dual-registered — unprefixed (legacy, deprecation window) and under /api/v2
  // (baseline convention) — until web-frontend/pos-frontend fully migrate to /api/v2.
  await notificationRoutes(fastify, db, config);
  await fastify.register(async (sub) => {
    await notificationRoutes(sub, db, config);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error instanceof Error ? error.message : String(error), url: request.url, correlationId: (request as { correlationId?: string }).correlationId }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });

  const address = await fastify.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ address }, 'Notification service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
