import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { purchaseOrderRoutes } from './api/purchase-order.routes.js';
import { grnRoutes } from './api/grn.routes.js';
import { landedCostRoutes } from './api/landed-cost.routes.js';
import { supplierPaymentRoutes } from './api/supplier-payment.routes.js';
import { purchaseReturnRoutes } from './api/purchase-return.routes.js';
import { expenseRoutes } from './api/expense.routes.js';
import { internalRoutes } from './api/internal.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['PURCHASE_SERVICE_PORT'] ?? '3020', 10);
  const logger = createLogger({ serviceName: 'purchase-service', level: 'info' });

  const ctxFactory = new PlatformContextFactory({
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'purchase-service',
    serviceName: 'purchase-service',
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
    return reply.code(200).send({ status: 'ok', service: 'purchase-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# purchase-service metrics\n');
  });

  await fastify.register(async (sub) => {
    await purchaseOrderRoutes(sub, ctxFactory);
    await grnRoutes(sub, ctxFactory);
    await landedCostRoutes(sub, ctxFactory);
    await supplierPaymentRoutes(sub, ctxFactory);
    await purchaseReturnRoutes(sub, ctxFactory);
    await expenseRoutes(sub, ctxFactory);
    await internalRoutes(sub, ctxFactory);
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
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in purchase-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Purchase service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
