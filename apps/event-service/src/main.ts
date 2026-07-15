/* global process */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Kafka } from 'kafkajs';
import {
  PlatformContextFactory,
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  checkKafka,
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
import { createDatabaseClient } from '@erp/db';
import { loadConfigWithSecrets } from '@erp/config';
import { eventStoreRoutes } from './api/event-store.routes.js';
import { dlqRoutes } from './api/dlq.routes.js';
import { sagaRoutes } from './api/saga.routes.js';
import { schemaRegistryRoutes } from './api/schema-registry.routes.js';
import { projectionRoutes } from './api/projections.routes.js';
import { performanceRoutes } from './api/performance.routes.js';
import { healthOutboxRoutes } from './api/health.outbox.routes.js';
import { OutboxRelayWorker } from './outbox/OutboxRelayWorker.js';
import { createEventServiceGstComplianceOrchestrator } from './sagas/gstComplianceProxy.js';

initializeTelemetry({ serviceName: 'event-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['EVENT_SERVICE_PORT'] ?? '3023', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'event-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const config = await loadConfigWithSecrets('event-service');
  const databaseUrl = config.databaseUrl;
  const kafkaBrokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(',');

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers,
    kafkaClientId: 'event-service',
    serviceName: 'event-service',
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  ctxFactory.subscribeTenantStatusInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  // Dedicated pool for the outbox relay worker — isolated from the HTTP handler
  // pool so the worker's SELECT ... FOR UPDATE SKIP LOCKED does not starve
  // concurrent HTTP requests during heavy throughput.
  const rawDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });

  // PG-006: registered once here (not per-request — SagaOrchestrator.register()
  // populates an in-memory map that a fresh per-request instance would lose
  // immediately, which was the pre-existing bug in saga.routes.ts).
  const gstComplianceOrchestrator = createEventServiceGstComplianceOrchestrator(rawDb);

  const worker = new OutboxRelayWorker({
    db: rawDb,
    kafkaBrokers,
    kafkaClientId: 'event-service-outbox',
    pollIntervalMs: parseInt(process.env['OUTBOX_RELAY_POLL_INTERVAL_MS'] ?? '500', 10),
    batchSize: parseInt(process.env['OUTBOX_RELAY_BATCH_SIZE'] ?? '100', 10),
    maxRetryAttempts: parseInt(process.env['OUTBOX_MAX_RETRY_ATTEMPTS'] ?? '5', 10),
  });

  const metricsHandler = await createMetricsHandler('event-service');
  const healthKafka = new Kafka({ clientId: 'event-service-health', brokers: kafkaBrokers });

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'event-service', logger);

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    methods: CORS_METHODS,
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? [
      'http://localhost:5173',
      'http://localhost:5174',
    ],
    credentials: true,
  });
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    redis: ctxFactory.getRedis(),
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('event-service'));

  registerHealthRoute(fastify, 'event-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
    kafka: () => checkKafka(healthKafka),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  await healthOutboxRoutes(fastify, worker);

  await fastify.register(
    async (sub) => {
      await eventStoreRoutes(sub, ctxFactory);
      await dlqRoutes(sub, ctxFactory, worker);
      await sagaRoutes(sub, ctxFactory, gstComplianceOrchestrator);
      await schemaRegistryRoutes(sub, ctxFactory);
      await projectionRoutes(sub, ctxFactory);
      await performanceRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Event service started');

  await worker.start();
  logger.info({}, 'OutboxRelayWorker started');

  const gracefulShutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received — stopping OutboxRelayWorker');
    worker
      .stop()
      .then(() => fastify.close())
      .then(() => ctxFactory.close())
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Error during graceful shutdown'
        );
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
