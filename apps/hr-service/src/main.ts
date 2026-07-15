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
import { loadConfigWithSecrets } from '@erp/config';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { employeeRoutes } from './api/employee.routes.js';
import { attendanceRoutes } from './api/attendance.routes.js';
import { attendanceImportConfigRoutes } from './api/attendance-import-config.routes.js';
import { leaveRoutes } from './api/leave.routes.js';
import { payrollRoutes } from './api/payroll.routes.js';
import { employeeLoanRoutes } from './api/employee-loans.routes.js';
import { alterationRoutes } from './api/alteration.routes.js';
import { tailorWorkLogRoutes } from './api/tailor-work-log.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { holidayRoutes } from './api/holiday.routes.js';
import { statutoryRoutes } from './api/statutory.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';

initializeTelemetry({ serviceName: 'hr-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['HR_SERVICE_PORT'] ?? '3021', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'hr-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });
  // FIELD_ENCRYPTION_KEY isn't part of AppConfig — extraSecrets fetches it
  // from Vault in production and writes it back into process.env, so the
  // requireEnv('FIELD_ENCRYPTION_KEY') calls elsewhere in this service pick
  // it up unchanged.
  const config = await loadConfigWithSecrets('hr-service', {
    extraSecrets: ['FIELD_ENCRYPTION_KEY'],
  });
  const databaseUrl = config.databaseUrl;

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'hr-service',
    serviceName: 'hr-service',
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

  const metricsHandler = await createMetricsHandler('hr-service');

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'hr-service', logger);

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
  fastify.addHook('onResponse', createHttpMetricsHook('hr-service'));

  registerHealthRoute(fastify, 'hr-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  await fastify.register(
    async (sub) => {
      await employeeRoutes(sub, ctxFactory);
      await attendanceRoutes(sub, ctxFactory);
      await attendanceImportConfigRoutes(sub, ctxFactory);
      await leaveRoutes(sub, ctxFactory);
      await payrollRoutes(sub, ctxFactory);
      await employeeLoanRoutes(sub, ctxFactory);
      await alterationRoutes(sub, ctxFactory);
      await tailorWorkLogRoutes(sub, ctxFactory);
      await holidayRoutes(sub, ctxFactory);
      await statutoryRoutes(sub, ctxFactory);
      await internalRoutes(sub);
      await searchSyncInternalRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'HR service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
