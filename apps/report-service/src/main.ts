import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import { HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { requireEnv } from '@erp/config';
import { ERPError } from '@erp/types';
import { PdfEngine } from './domain/PdfEngine.js';
import { reportRoutes } from './api/report.routes.js';
import { analyticsReportsRoutes } from './api/analytics-reports.routes.js';
import { dashboardRoutes } from './api/dashboard.routes.js';
import { ScheduledReportJob } from './scheduler/ScheduledReportJob.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['REPORT_SERVICE_PORT'] ?? '3015', 10);
  const databaseUrl = requireEnv('DATABASE_URL');

  const logger = createLogger({ serviceName: 'report-service', level: 'info' });
  const db = createDatabaseClient({ url: databaseUrl });

  const pdfEngine = new PdfEngine();

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
    return reply.code(200).send({ status: 'ok', service: 'report-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# report-service metrics\n');
  });

  // Existing routes (PDF generation, number series)
  await reportRoutes(fastify, db, pdfEngine);

  // Phase 11: Analytics reports + dashboard + POS analytics
  await analyticsReportsRoutes(fastify, db);
  await dashboardRoutes(fastify, db);

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });

  const scheduledJob = new ScheduledReportJob(db, logger);

  const gracefulShutdown = async (): Promise<void> => {
    await scheduledJob.stop();
    await pdfEngine.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void gracefulShutdown(); });
  process.on('SIGINT', () => { void gracefulShutdown(); });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Report service started');

  pdfEngine.init().then(() => {
    logger.info({}, 'PDF engine initialized');
  }).catch((err: Error) => {
    logger.error({ err: err.message }, 'PDF engine failed to initialize');
  });

  scheduledJob.start().then(() => {
    logger.info({}, 'Scheduled report job started');
  }).catch((err: Error) => {
    logger.error({ err: err.message }, 'Scheduled report job failed to start');
  });
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
