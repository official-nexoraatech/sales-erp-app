import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PlatformContextFactory, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createLogger, createMetricsHandler, erpInvoiceCreateTotal, erpInvoiceCreateFailedTotal, erpHttpRequestTotal, erpHttpErrorTotal } from '@erp/logger';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { customerRoutes } from './api/customer.routes.js';
import { supplierRoutes } from './api/supplier.routes.js';
import { quotationRoutes } from './api/quotation.routes.js';
import { invoiceRoutes } from './api/invoice.routes.js';
import { posRoutes } from './api/pos.routes.js';
import { paymentRoutes } from './api/payment.routes.js';
import { saleReturnRoutes } from './api/sale-return.routes.js';
import { loyaltyRoutes } from './api/loyalty.routes.js';
import { deliveryChallanRoutes } from './api/delivery-challan.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { crmRoutes } from './api/crm.routes.js';
import { dashboardRoutes } from './api/dashboard.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SALES_SERVICE_PORT'] ?? '3013', 10);
  const logger = createLogger({ serviceName: 'sales-service', level: 'info' });

  const metricsHandler = await createMetricsHandler('sales-service');

  const ctxFactory = new PlatformContextFactory({
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'sales-service',
    serviceName: 'sales-service',
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
    return reply.code(200).send({ status: 'ok', service: 'sales-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // Instrument every response for erp_http_request_total and erp_http_error_total
  fastify.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    const route = request.routeOptions?.url ?? request.url;
    const status = String(reply.statusCode);
    erpHttpRequestTotal.inc({ method, route, status_code: status });
    if (reply.statusCode >= 500) {
      erpHttpErrorTotal.inc({ method, route });
    }
    // Track invoice creations for the erp_invoice_create_total counter
    if (method === 'POST' && route === '/api/v2/invoices') {
      const tenantId = String((request as { auth?: { tenantId?: number } }).auth?.tenantId ?? 'unknown');
      if (reply.statusCode === 201) {
        erpInvoiceCreateTotal.inc({ tenant_id: tenantId, branch_id: 'unknown' });
      } else if (reply.statusCode >= 400) {
        erpInvoiceCreateFailedTotal.inc({ tenant_id: tenantId, reason: status });
      }
    }
  });

  await fastify.register(async (sub) => {
    await customerRoutes(sub, ctxFactory);
    await supplierRoutes(sub, ctxFactory);
    await quotationRoutes(sub, ctxFactory);
    await invoiceRoutes(sub, ctxFactory);
    await posRoutes(sub, ctxFactory);
    await paymentRoutes(sub, ctxFactory);
    await saleReturnRoutes(sub, ctxFactory);
    await loyaltyRoutes(sub, ctxFactory);
    await deliveryChallanRoutes(sub, ctxFactory);
    await crmRoutes(sub, ctxFactory);
    await dashboardRoutes(sub, ctxFactory);
    await internalRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in sales-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Sales service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
