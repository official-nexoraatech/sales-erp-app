import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Redis from 'ioredis';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { jobWorkRoutes } from './api/job-work.routes.js';
import { barcodeRoutes } from './api/barcode.routes.js';
import { consignmentRoutes } from './api/consignment.routes.js';
import { reorderRoutes } from './api/reorder.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['PRODUCTION_SERVICE_PORT'] ?? '3022', 10);
  const logger = createLogger({ serviceName: 'production-service', level: 'info' });

  const ctxFactory = new PlatformContextFactory({
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'production-service',
    serviceName: 'production-service',
  });
  await ctxFactory.connect();

  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis connection error in production-service');
  });

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
    return reply.code(200).send({ status: 'ok', service: 'production-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# production-service metrics\n');
  });

  await fastify.register(async (sub) => {
    await jobWorkRoutes(sub, ctxFactory);
    await barcodeRoutes(sub, ctxFactory, redis);
    await consignmentRoutes(sub, ctxFactory);
    await reorderRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error.validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: error.validation },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in production-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Production service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
