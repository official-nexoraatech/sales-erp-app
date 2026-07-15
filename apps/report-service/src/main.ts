import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { createDatabaseClient, createReadReplicaClient, ReplicaRouter } from '@erp/db';
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
  erpReplicaFallbackTotal,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import { PdfEngine } from './domain/PdfEngine.js';
import { reportRoutes } from './api/report.routes.js';
import { analyticsReportsRoutes } from './api/analytics-reports.routes.js';
import { dashboardRoutes } from './api/dashboard.routes.js';
import { ScheduledReportJob } from './scheduler/ScheduledReportJob.js';

initializeTelemetry({ serviceName: 'report-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['REPORT_SERVICE_PORT'] ?? '3015', 10);
  const config = await loadConfigWithSecrets('report-service');
  const databaseUrl = config.databaseUrl;

  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'report-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });
  const db = createDatabaseClient({ url: databaseUrl });
  initTenantStatusEnforcement(db);

  // PG-005: report definitions + dashboard queries are read-only — route them through the
  // read replica (docker-compose's erp-postgres-replica) with a lag-aware fallback to `db`.
  // Report definitions use ReplicaRouter's 5s default; dashboards get a looser 120s threshold
  // matching projection_dashboard_daily's own documented staleness tolerance (event-service's
  // STALE_TOLERANCE_MS), since a replica within that window is already "fresh enough" today.
  const replicaDb = createReadReplicaClient({ url: config.databaseReplicaUrl });
  const onReplicaFallback = (): void => {
    erpReplicaFallbackTotal.inc({ service: 'report-service' });
  };
  const reportReplicaRouter = new ReplicaRouter(db, replicaDb, { onFallback: onReplicaFallback });
  const dashboardReplicaRouter = new ReplicaRouter(db, replicaDb, {
    maxLagMs: 120_000,
    onFallback: onReplicaFallback,
  });

  // ES-26 (M7): 3-minute cache for the GST-payable report — the only cached query in this service.
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect().catch((err: Error) => {
    logger.warn({ err: err.message }, 'Redis connect failed — report caching disabled');
  });
  subscribeToTenantStatusInvalidations(redis);

  const pdfEngine = new PdfEngine();
  const metricsHandler = await createMetricsHandler('report-service');

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'report-service', logger);

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
  // Rate limiting still uses the in-memory store, not the report-cache Redis connection above
  // (same fallback auth-service uses when Redis is unavailable).
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('report-service'));

  // Redis backs an optional 3-min report cache only (see ReportEngine) — not a health-gate
  // dependency, since every cached report has a working Postgres fallback on cache miss/failure.
  registerHealthRoute(fastify, 'report-service', {
    db: () => checkDatabase(db),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // PG-010: reportRoutes' handlers use bare paths (/reports/pdf etc.) — dual-registered
  // unprefixed (legacy, deprecation window) and under /api/v2 (baseline convention).
  // analyticsReportsRoutes/dashboardRoutes already hardcode /api/v2 (and /api/v1, for the
  // two aging reports) directly into their literal route paths — registering them a second
  // time under an outer /api/v2 prefix would double it (/api/v2/api/v2/reports), so they
  // stay registered once, as-is; their pre-existing versioning is untouched by this change.
  await reportRoutes(fastify, db, pdfEngine);
  await fastify.register(
    async (sub) => {
      await reportRoutes(sub, db, pdfEngine);
    },
    { prefix: '/api/v2' }
  );

  await analyticsReportsRoutes(fastify, db, redis, reportReplicaRouter);
  await dashboardRoutes(fastify, db, dashboardReplicaRouter);

  const scheduledJob = new ScheduledReportJob(db, logger, redis);

  const gracefulShutdown = async (): Promise<void> => {
    await scheduledJob.stop();
    await pdfEngine.close();
    await redis.quit().catch(() => undefined);
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
  logger.info({ address }, 'Report service started');

  pdfEngine
    .init()
    .then(() => {
      logger.info({}, 'PDF engine initialized');
    })
    .catch((err: Error) => {
      logger.error({ err: err.message }, 'PDF engine failed to initialize');
    });

  scheduledJob
    .start()
    .then(() => {
      logger.info({}, 'Scheduled report job started');
    })
    .catch((err: Error) => {
      logger.error({ err: err.message }, 'Scheduled report job failed to start');
    });
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
