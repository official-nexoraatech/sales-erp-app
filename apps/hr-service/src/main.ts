import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { createLogger } from '@erp/logger';
import { employeeRoutes } from './api/employee.routes.js';
import { attendanceRoutes } from './api/attendance.routes.js';
import { leaveRoutes } from './api/leave.routes.js';
import { payrollRoutes } from './api/payroll.routes.js';
import { alterationRoutes } from './api/alteration.routes.js';
import { tailorWorkLogRoutes } from './api/tailor-work-log.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { holidayRoutes } from './api/holiday.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['HR_SERVICE_PORT'] ?? '3021', 10);
  const logger = createLogger({ serviceName: 'hr-service', level: 'info' });
  const databaseUrl = requireEnv('DATABASE_URL');

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'hr-service',
    serviceName: 'hr-service',
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
    return reply.code(200).send({ status: 'ok', service: 'hr-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# hr-service metrics\n');
  });

  await fastify.register(async (sub) => {
    await employeeRoutes(sub, ctxFactory);
    await attendanceRoutes(sub, ctxFactory);
    await leaveRoutes(sub, ctxFactory);
    await payrollRoutes(sub, ctxFactory);
    await alterationRoutes(sub, ctxFactory);
    await tailorWorkLogRoutes(sub, ctxFactory);
    await holidayRoutes(sub, ctxFactory);
    await internalRoutes(sub);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in hr-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'HR service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
