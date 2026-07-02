import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Redis from 'ioredis';
import { HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import { createLogger } from '@erp/logger';
import { requireEnv } from '@erp/config';
import { ERPError } from '@erp/types';
import { JobRegistry } from './JobRegistry.js';
import { registerSystemJobs } from './jobs/system-jobs.js';
import { schedulerRoutes } from './api/scheduler.routes.js';
import { importRoutes } from './api/import.routes.js';
import { exportRoutes } from './api/export.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SCHEDULER_SERVICE_PORT'] ?? '3016', 10);
  const databaseUrl = requireEnv('DATABASE_URL');
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  const logger = createLogger({ serviceName: 'scheduler-service', level: 'info' });
  const db = createDatabaseClient({ url: databaseUrl });

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect();
  logger.info({}, 'Redis connected');

  const registry = new JobRegistry(redis);
  registerSystemJobs(registry);

  for (const { name } of registry.listAll()) {
    await registry.schedule(name).catch((err: unknown) => {
      logger.warn({ name, err }, 'Failed to schedule job (non-fatal)');
    });
  }

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
    return reply.code(200).send({
      status: 'ok',
      service: 'scheduler-service',
      registeredJobs: registry.listAll().length,
    });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# scheduler-service metrics\n');
  });

  await schedulerRoutes(fastify, db, registry);
  await importRoutes(fastify, db);
  await exportRoutes(fastify, db);

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });

  const gracefulShutdown = async (): Promise<void> => {
    await registry.closeAll();
    await redis.quit();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void gracefulShutdown(); });
  process.on('SIGINT', () => { void gracefulShutdown(); });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address, registeredJobs: registry.listAll().length }, 'Scheduler service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
