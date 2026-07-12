/* global crypto, setInterval */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import {
  PlatformContextFactory,
  HELMET_OPTIONS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  initializeTelemetry,
  initTenantStatusEnforcement,
  registerErrorHandler,
} from '@erp/sdk';
import {
  createLogger,
  createMetricsHandler,
  erpInvoiceCreateTotal,
  erpInvoiceCreateFailedTotal,
  erpHttpRequestTotal,
  erpHttpErrorTotal,
  erpHttpRequestDuration,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
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
import { attachmentRoutes } from './api/attachment.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';
import { syncRoutes } from './api/sync.routes.js';

initializeTelemetry({ serviceName: 'sales-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SALES_SERVICE_PORT'] ?? '3013', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'sales-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const metricsHandler = await createMetricsHandler('sales-service');

  const config = await loadConfigWithSecrets('sales-service');
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'sales-service',
    serviceName: 'sales-service',
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

  const fastify = Fastify({ logger: false, trustProxy: true });

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
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

  registerHealthRoute(fastify, 'sales-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // PG-028: in-memory per-tenant API-call counter, flushed periodically as a single batched
  // usage_events row (USAGE_API_CALL_BATCH) rather than a write per request — a per-request
  // DB/Kafka write here would add unacceptable latency/load to every request in the system.
  const apiCallCounts = new Map<number, number>();
  const API_CALL_FLUSH_INTERVAL_MS = 60_000;
  const flushApiCallCounts = async (): Promise<void> => {
    const snapshot = new Map(apiCallCounts);
    apiCallCounts.clear();
    for (const [tenantId, count] of snapshot) {
      if (count <= 0) continue;
      try {
        const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
        await ctx.events.publish('usage', tenantId, 'USAGE_API_CALL_BATCH', {
          quantity: count,
          service: 'sales-service',
        });
      } catch (err) {
        logger.warn({ tenantId, err }, 'Failed to flush API-call usage batch (non-fatal)');
      }
    }
  };
  setInterval(() => {
    void flushApiCallCounts();
  }, API_CALL_FLUSH_INTERVAL_MS).unref();

  // Instrument every response for erp_http_request_total and erp_http_error_total
  fastify.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    const route = request.routeOptions?.url ?? request.url;
    const status = String(reply.statusCode);
    erpHttpRequestTotal.inc({ method, route, status_code: status });
    erpHttpRequestDuration.observe(
      { method, route, status_code: status, service: 'sales-service' },
      reply.elapsedTime / 1000
    );
    if (reply.statusCode >= 500) {
      erpHttpErrorTotal.inc({ method, route });
    }
    // Track invoice creations for the erp_invoice_create_total counter
    if (method === 'POST' && route === '/api/v2/invoices') {
      const tenantId = String(
        (request as { auth?: { tenantId?: number } }).auth?.tenantId ?? 'unknown'
      );
      if (reply.statusCode === 201) {
        erpInvoiceCreateTotal.inc({ tenant_id: tenantId, branch_id: 'unknown' });
      } else if (reply.statusCode >= 400) {
        erpInvoiceCreateFailedTotal.inc({ tenant_id: tenantId, reason: status });
      }
    }
    // PG-028: batched API-call usage counting — see flushApiCallCounts above.
    const authTenantId = (request as { auth?: { tenantId?: number } }).auth?.tenantId;
    if (authTenantId !== undefined) {
      apiCallCounts.set(authTenantId, (apiCallCounts.get(authTenantId) ?? 0) + 1);
    }
  });

  await fastify.register(
    async (sub) => {
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
      await attachmentRoutes(sub, ctxFactory);
      await searchSyncInternalRoutes(sub, ctxFactory);
      await syncRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  registerErrorHandler(fastify, 'sales-service', logger);

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Sales service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
