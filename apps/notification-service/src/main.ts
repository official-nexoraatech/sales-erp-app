import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { createDatabaseClient } from '@erp/db';
import {
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  checkDatabase,
  initializeTelemetry,
  initTenantStatusEnforcement,
  subscribeToTenantStatusInvalidations,
  registerErrorHandler,
} from '@erp/sdk';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadNotificationConfig } from './config.js';
import { notificationRoutes } from './api/notification.routes.js';
import { webhookRoutes } from './api/webhook.routes.js';

initializeTelemetry({ serviceName: 'notification-service' });

async function bootstrap(): Promise<void> {
  const config = await loadNotificationConfig();
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'notification-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const db = createDatabaseClient({ url: config.databaseUrl });
  initTenantStatusEnforcement(db);
  const metricsHandler = await createMetricsHandler('notification-service');

  // Tenant-status pub/sub invalidation, and (CP-9 follow-up) the per-tenant notification
  // rate-limit counter used by /notifications/send-raw-internal — see domain/tenantRateLimit.ts.
  // The global @fastify/rate-limit plugin below is a separate, IP-or-JWT-tenant-keyed limiter
  // for the rest of this service's routes.
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  redis.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis connection error in notification-service');
  });
  subscribeToTenantStatusInvalidations(redis);

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'notification-service', logger);

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    methods: CORS_METHODS,
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });
  // In-memory rate-limit store (same fallback auth-service uses) — the Redis connection
  // above is dedicated to tenant-status invalidation, not wired up as the rate-limit store.
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
  await notificationRoutes(fastify, db, config, redis);
  await fastify.register(
    async (sub) => {
      await notificationRoutes(sub, db, config, redis);
    },
    { prefix: '/api/v2' }
  );

  // CP-6: public-facing delivery-status webhooks (MSG91/SendGrid/Meta) — registered in its own
  // encapsulated sub-plugin so its raw-body content-type parser doesn't affect the routes above.
  await fastify.register(async (sub) => {
    await webhookRoutes(sub, db, config);
  });

  const address = await fastify.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ address }, 'Notification service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
