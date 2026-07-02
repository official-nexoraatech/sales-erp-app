import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { warehouseRoutes } from './api/warehouse.routes.js';
import { categoryRoutes } from './api/category.routes.js';
import { brandRoutes } from './api/brand.routes.js';
import { unitRoutes } from './api/unit.routes.js';
import { itemRoutes } from './api/item.routes.js';
import { stockRoutes } from './api/stock.routes.js';
import { reservationRoutes } from './api/reservation.routes.js';
import { transferRoutes } from './api/transfer.routes.js';
import { adjustmentRoutes } from './api/adjustment.routes.js';
import { physicalVerificationRoutes } from './api/physical-verification.routes.js';
import { fabricRollRoutes } from './api/fabric-roll.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['INVENTORY_SERVICE_PORT'] ?? '3012', 10);
  const logger = createLogger({ serviceName: 'inventory-service', level: 'info' });

  const ctxFactory = new PlatformContextFactory({
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'inventory-service',
    serviceName: 'inventory-service',
  });
  await ctxFactory.connect();

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
    return reply.code(200).send({ status: 'ok', service: 'inventory-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# inventory-service metrics\n');
  });

  await fastify.register(async (sub) => {
    await warehouseRoutes(sub, ctxFactory);
    await categoryRoutes(sub, ctxFactory);
    await brandRoutes(sub, ctxFactory);
    await unitRoutes(sub, ctxFactory);
    await itemRoutes(sub, ctxFactory);
    await stockRoutes(sub, ctxFactory);
    await reservationRoutes(sub, ctxFactory);
    await transferRoutes(sub, ctxFactory);
    await adjustmentRoutes(sub, ctxFactory);
    await physicalVerificationRoutes(sub, ctxFactory);
    await fabricRollRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in inventory-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Inventory service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
