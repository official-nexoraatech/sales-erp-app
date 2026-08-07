import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Queue, Worker } from 'bullmq';
import {
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  checkDatabase,
  checkKafka,
  initializeTelemetry,
  initTenantStatusEnforcement,
  subscribeToTenantStatusInvalidations,
  PlatformEventConsumer,
  TenantScopedDatabase,
  registerErrorHandler,
} from '@erp/sdk';
import { createDatabaseClient, workflowDefinitions } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import type { ERPEventPayload } from '@erp/types';
import { EventTypes } from '@erp/types';
import { TriggerRegistry } from './domain/TriggerRegistry.js';
import { WorkflowExecutionEngine } from './domain/WorkflowExecutionEngine.js';
import { HttpNotificationDispatcher, OutboxActionPublisher } from './domain/automation-infra.js';
import { automationRoutes } from './api/automation.routes.js';

initializeTelemetry({ serviceName: 'automation-service' });

// Same real transform OutboxRelayWorker.ts uses to derive a Kafka topic from an eventType
// string (`erp.${eventType.toLowerCase().replace(/_/g, '.')}`) — NOT the aspirational,
// unreconciled `KafkaTopics` interface in packages/shared-types/src/events.ts, which uses a
// different naming scheme that doesn't match what OutboxRelayWorker actually publishes.
// EventTypes' keys ARE real, individually-verified eventType strings already used as
// outboxEvents.eventType values by their owning producers.
function topicFor(eventType: string): string {
  return `erp.${eventType.toLowerCase().replace(/_/g, '.')}`;
}

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['AUTOMATION_SERVICE_PORT'] ?? '3024', 10);
  const config = await loadConfigWithSecrets('automation-service');
  const databaseUrl = config.databaseUrl;
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'automation-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });
  const db = createDatabaseClient({ url: databaseUrl });
  initTenantStatusEnforcement(db);

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect();
  logger.info({}, 'Redis connected');
  subscribeToTenantStatusInvalidations(redis);

  const engine = new WorkflowExecutionEngine(
    db,
    new HttpNotificationDispatcher(db),
    new OutboxActionPublisher(db)
  );
  const triggerRegistry = new TriggerRegistry(db, engine);

  // ── EVENT-type triggers: Kafka consumer ─────────────────────────────────────
  const kafka = new Kafka({
    clientId: 'automation-service-consumer',
    brokers: config.kafkaBrokers,
  });
  const consumer = new PlatformEventConsumer(
    kafka,
    'automation-service-group',
    'automation-service'
  );
  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });
  const consumerEngine = new WorkflowExecutionEngine(
    consumerDb,
    new HttpNotificationDispatcher(consumerDb),
    new OutboxActionPublisher(consumerDb)
  );
  const consumerTriggerRegistry = new TriggerRegistry(consumerDb, consumerEngine);
  const topics = Object.values(EventTypes).map(topicFor);
  await consumer.subscribe(
    topics,
    async (event: ERPEventPayload, _tenantDb: TenantScopedDatabase) => {
      await consumerTriggerRegistry.handleEvent(event.tenantId, event.eventType, event.payload);
    },
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({ topicCount: topics.length }, 'Automation Kafka consumer started');

  // ── CRON-type triggers: BullMQ repeatable job re-scanned on a fixed interval ─
  // Re-derives the active CRON definition set every 5 minutes (rather than a one-time
  // schedule() call per definition at boot, like scheduler-service's tenant-scoped jobs)
  // because tenant-authored definitions can be created/toggled at any time via the API —
  // a fixed boot-time registration would go stale the moment an admin adds a new one.
  const cronQueue = new Queue('automation-cron-scan', { connection: redis });
  await cronQueue.add(
    'scan',
    {},
    { repeat: { every: 5 * 60 * 1000 }, jobId: 'automation-cron-scan-repeat' }
  );
  const cronWorker = new Worker(
    'automation-cron-scan',
    async () => {
      const active = await db
        .select({ id: workflowDefinitions.id, tenantId: workflowDefinitions.tenantId })
        .from(workflowDefinitions)
        .where(
          and(eq(workflowDefinitions.triggerType, 'CRON'), eq(workflowDefinitions.isActive, true))
        );
      for (const def of active) {
        await triggerRegistry.handleCron(def.id, def.tenantId).catch((err: unknown) => {
          logger.warn({ err, definitionId: def.id }, 'CRON automation trigger failed (non-fatal)');
        });
      }
    },
    { connection: redis }
  );

  const metricsHandler = await createMetricsHandler('automation-service');

  const fastify = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(fastify, 'automation-service', logger);
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
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    redis,
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('automation-service'));

  registerHealthRoute(fastify, 'automation-service', {
    db: () => checkDatabase(db),
    redis: async () => {
      try {
        return (await redis.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    kafka: () => checkKafka(kafka),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  const registerRoutes = async (sub: FastifyInstance): Promise<void> => {
    await automationRoutes(sub, db, triggerRegistry);
  };
  // Each call below gets its own Fastify encapsulation context, so automationRoutes'
  // blanket `addHook('preHandler', authenticate)` stays scoped to that child instance and
  // never leaks onto /health or /metrics, which live on the root instance.
  await fastify.register(registerRoutes);
  await fastify.register(registerRoutes, { prefix: '/api/v2' });

  const gracefulShutdown = async (): Promise<void> => {
    await consumer.stop();
    await cronWorker.close();
    await cronQueue.close();
    await redis.quit();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void gracefulShutdown();
  });
  process.on('SIGINT', () => {
    void gracefulShutdown();
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Automation service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
