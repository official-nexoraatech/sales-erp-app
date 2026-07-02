/* global process */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { createDatabaseClient } from '@erp/db';
import { eventStoreRoutes } from './api/event-store.routes.js';
import { dlqRoutes } from './api/dlq.routes.js';
import { sagaRoutes } from './api/saga.routes.js';
import { schemaRegistryRoutes } from './api/schema-registry.routes.js';
import { projectionRoutes } from './api/projections.routes.js';
import { performanceRoutes } from './api/performance.routes.js';
import { healthOutboxRoutes } from './api/health.outbox.routes.js';
import { OutboxRelayWorker } from './outbox/OutboxRelayWorker.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['EVENT_SERVICE_PORT'] ?? '3023', 10);
  const logger = createLogger({ serviceName: 'event-service', level: 'info' });

  const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://erp:erp_password@localhost:5435/erp';
  const kafkaBrokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(',');

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers,
    kafkaClientId: 'event-service',
    serviceName: 'event-service',
  });
  await ctxFactory.connect();

  // Dedicated pool for the outbox relay worker — isolated from the HTTP handler
  // pool so the worker's SELECT ... FOR UPDATE SKIP LOCKED does not starve
  // concurrent HTTP requests during heavy throughput.
  const rawDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });

  const worker = new OutboxRelayWorker({
    db: rawDb,
    kafkaBrokers,
    kafkaClientId: 'event-service-outbox',
    pollIntervalMs: parseInt(process.env['OUTBOX_RELAY_POLL_INTERVAL_MS'] ?? '500', 10),
    batchSize: parseInt(process.env['OUTBOX_RELAY_BATCH_SIZE'] ?? '100', 10),
    maxRetryAttempts: parseInt(process.env['OUTBOX_MAX_RETRY_ATTEMPTS'] ?? '5', 10),
  });

  const fastify = Fastify({ logger: false, trustProxy: true });

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  });

  fastify.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok', service: 'event-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# event-service metrics\n');
  });

  await healthOutboxRoutes(fastify, worker);

  await fastify.register(
    async (sub) => {
      await eventStoreRoutes(sub, ctxFactory);
      await dlqRoutes(sub, ctxFactory);
      await sagaRoutes(sub, ctxFactory);
      await schemaRegistryRoutes(sub, ctxFactory);
      await projectionRoutes(sub, ctxFactory);
      await performanceRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in event-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Event service started');

  await worker.start();
  logger.info({}, 'OutboxRelayWorker started');

  const gracefulShutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received — stopping OutboxRelayWorker');
    worker.stop()
      .then(() => fastify.close())
      .then(() => ctxFactory.close())
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Error during graceful shutdown');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
