import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createDatabaseClient } from '@erp/db';
import { HELMET_OPTIONS, PERMISSIONS_POLICY, registerHealthRoute, tenantOrIpKeyGenerator, checkDatabase, initializeTelemetry, initTenantStatusEnforcement, PlatformContextFactory } from '@erp/sdk';
import { createLogger, createMetricsHandler, createHttpMetricsHook, createCorrelationIdHook } from '@erp/logger';
import { ERPError } from '@erp/types';
import { loadTenantConfig } from './config.js';
import { tenantRoutes } from './api/tenant.routes.js';
import { approvalRoutes } from './api/approval.routes.js';
import { organizationRoutes } from './api/organization.routes.js';
import { ssoConfigRoutes } from './api/sso-config.routes.js';
import { branchRoutes } from './api/branch.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';
import { usageRoutes } from './api/usage.routes.js';

initializeTelemetry({ serviceName: 'tenant-service' });

async function bootstrap(): Promise<void> {
  const config = await loadTenantConfig();
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({ serviceName: 'tenant-service', level: 'info', ...(lokiUrl ? { lokiUrl } : {}) });

  const db = createDatabaseClient({ url: config.databaseUrl });
  initTenantStatusEnforcement(db);
  const metricsHandler = await createMetricsHandler('tenant-service');

  // Search-service sync (Phase 2): branch/organization routes need outbox event
  // publishing, which only PlatformContextFactory provides. Every other route in this
  // service still gets the plain `db` above — scoped to branchRoutes/organizationRoutes
  // only, not a service-wide migration, so it runs its own separate DB pool and Redis
  // connection (this service otherwise has no Redis connection at all — see the rate-limit
  // registration below).
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
    kafkaBrokers: config.kafkaBrokers,
    kafkaClientId: 'tenant-service',
    serviceName: 'tenant-service',
  });
  await ctxFactory.connect();

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
  fastify.addHook('onResponse', createHttpMetricsHook('tenant-service'));

  registerHealthRoute(fastify, 'tenant-service', {
    db: () => checkDatabase(db),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  await fastify.register(async (sub) => {
    await tenantRoutes(sub, db, config);
    await approvalRoutes(sub, db);
    await organizationRoutes(sub, ctxFactory);
    await ssoConfigRoutes(sub, ctxFactory);
    await branchRoutes(sub, ctxFactory);
    await searchSyncInternalRoutes(sub, db);
    await usageRoutes(sub, db);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    logger.error({ err: error.message, url: request.url, correlationId: (request as { correlationId?: string }).correlationId }, 'Unhandled error in tenant-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ address }, 'Tenant service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
