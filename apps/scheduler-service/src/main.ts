import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
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
  StorageClient,
  PlatformEventConsumer,
  TenantScopedDatabase,
  registerErrorHandler,
} from '@erp/sdk';
import { createDatabaseClient, tenants } from '@erp/db';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import { JobRegistry } from './JobRegistry.js';
import { registerSystemJobs } from './jobs/system-jobs.js';
import { registerProjectionRebuildJobs } from './jobs/projectionRebuildJobs.js';
import { registerExportGenerateJob } from './jobs/exportGenerateJob.js';
import { registerUsageRollupJob } from './jobs/usageRollup.js';
import { handleUsageEvent } from './jobs/usageEventConsumer.js';
import { schedulerRoutes } from './api/scheduler.routes.js';
import { importRoutes } from './api/import.routes.js';
import { exportRoutes } from './api/export.routes.js';

initializeTelemetry({ serviceName: 'scheduler-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SCHEDULER_SERVICE_PORT'] ?? '3016', 10);
  const config = await loadConfigWithSecrets('scheduler-service');
  const databaseUrl = config.databaseUrl;
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'scheduler-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });
  const db = createDatabaseClient({ url: databaseUrl });
  initTenantStatusEnforcement(db);

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect();
  logger.info({}, 'Redis connected');
  subscribeToTenantStatusInvalidations(redis);

  const storage = new StorageClient({
    endpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
    accessKeyId: process.env['MINIO_ACCESS_KEY'] ?? 'erp_minio',
    secretAccessKey: process.env['MINIO_SECRET_KEY'] ?? 'erp_minio_secret',
    useSSL: process.env['MINIO_USE_SSL'] === 'true',
    bucket: process.env['MINIO_BUCKET'] ?? 'erp-storage',
  });

  const registry = new JobRegistry(redis);
  registerSystemJobs(registry, db, storage);
  registerProjectionRebuildJobs(registry, db);
  registerExportGenerateJob(registry, db, storage);
  registerUsageRollupJob(registry, db);

  // PG-028: consumes USAGE_* events (published via the outbox pattern by sales-service etc.)
  // into the durable usage_events table the usage-rollup job above reads from. scheduler-
  // service had no prior Kafka wiring — search-sync jobs poll owning services over HTTP,
  // they don't consume Kafka — so this is new infrastructure for this service, mirroring
  // gst-service's consumer setup exactly (see apps/gst-service/src/main.ts).
  const kafka = new Kafka({
    clientId: 'scheduler-service-consumer',
    brokers: config.kafkaBrokers,
  });
  const usageConsumer = new PlatformEventConsumer(
    kafka,
    'scheduler-service-group',
    'scheduler-service'
  );
  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });
  await usageConsumer.subscribe(
    ['erp.usage.invoice.created', 'erp.usage.api.call.batch'],
    handleUsageEvent,
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({}, 'Usage-event Kafka consumer started');

  // PG-026: tenantScoped jobs must run once per active tenant, not once with an
  // undefined tenantId — the bug this fixes meant every tenantScoped job (including
  // already-real ones like search.full-reindex, which guards `if (tenantId ===
  // undefined) return`) never actually ran via its cron schedule.
  const activeTenantIds = (
    await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'ACTIVE'))
  ).map((row) => row.id);

  // manualOnly jobs (projection rebuild — PG-008) are trigger-only and must not
  // get a recurring cron `schedule()` call.
  for (const { name, config } of registry.listAll()) {
    if (config.manualOnly) continue;

    if (config.tenantScoped) {
      for (const tenantId of activeTenantIds) {
        await registry.schedule(name, tenantId).catch((err: unknown) => {
          logger.warn({ name, tenantId, err }, 'Failed to schedule tenant-scoped job (non-fatal)');
        });
      }
    } else {
      await registry.schedule(name).catch((err: unknown) => {
        logger.warn({ name, err }, 'Failed to schedule job (non-fatal)');
      });
    }
  }

  const metricsHandler = await createMetricsHandler('scheduler-service');

  const fastify = Fastify({ logger: false, trustProxy: true });
  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'scheduler-service', logger);
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
  fastify.addHook('onResponse', createHttpMetricsHook('scheduler-service'));

  registerHealthRoute(fastify, 'scheduler-service', {
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

  // PG-010: dual-registered — unprefixed (legacy, deprecation window) and under /api/v2
  // (baseline convention) — until web-frontend/pos-frontend fully migrate to /api/v2.
  const registerSchedulerRoutes = async (sub: FastifyInstance): Promise<void> => {
    await schedulerRoutes(sub, db, registry);
    await importRoutes(sub, db);
    await exportRoutes(sub, db, registry);
  };

  await registerSchedulerRoutes(fastify);
  await fastify.register(registerSchedulerRoutes, { prefix: '/api/v2' });

  const gracefulShutdown = async (): Promise<void> => {
    await usageConsumer.stop();
    await registry.closeAll();
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
  logger.info({ address, registeredJobs: registry.listAll().length }, 'Scheduler service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
