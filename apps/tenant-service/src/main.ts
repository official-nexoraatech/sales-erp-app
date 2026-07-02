import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createDatabaseClient } from '@erp/db';
import { HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { loadTenantConfig } from './config.js';
import { tenantRoutes } from './api/tenant.routes.js';
import { approvalRoutes } from './api/approval.routes.js';
import { organizationRoutes } from './api/organization.routes.js';
import { branchRoutes } from './api/branch.routes.js';

async function bootstrap(): Promise<void> {
  const config = loadTenantConfig();
  const logger = createLogger({ serviceName: 'tenant-service', level: 'info' });

  const db = createDatabaseClient({ url: config.databaseUrl });

  const fastify = Fastify({ logger: false, trustProxy: true });

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  fastify.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok', service: 'tenant-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# tenant-service metrics\n');
  });

  await fastify.register(async (sub) => {
    await tenantRoutes(sub, db, config);
    await approvalRoutes(sub, db);
    await organizationRoutes(sub, db);
    await branchRoutes(sub, db);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in tenant-service');
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

export { createTenantContextMiddleware } from './middleware/tenantContext.js';
