import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Kafka } from 'kafkajs';
import {
  PlatformContextFactory,
  TenantScopedDatabase,
  type EventHandler,
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  checkKafka,
  initializeTelemetry,
  initTenantStatusEnforcement,
  registerErrorHandler,
} from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import { hsnMaster } from '@erp/db';
import { gstRoutes } from './api/gst.routes.js';
import { gstRegisterRoutes } from './api/gst-register.routes.js';
import { gstr1Routes } from './api/gstr1.routes.js';
import { gstr3bRoutes } from './api/gstr3b.routes.js';
import { gstr9Routes } from './api/gstr9.routes.js';
import { rcmRoutes } from './api/rcm.routes.js';
import { einvoiceRoutes } from './api/einvoice.routes.js';
import { ewayBillRoutes } from './api/eway-bill.routes.js';
import { gstr2aRoutes } from './api/gstr2a.routes.js';
import { gstReturnsRoutes } from './api/gst-returns.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { HSN_SEED_DATA } from './domain/hsn-seed.js';
import { handleInvoiceConfirmed } from './consumers/InvoiceGstConsumer.js';
import { handleSaleReturnApproved } from './consumers/SaleReturnGstConsumer.js';
import { handleGRNApproved, handlePurchaseReturnApproved } from './consumers/GRNGstConsumer.js';
import {
  handleInvoiceConfirmedForEinvoice,
  handleInvoiceCancelledForEinvoice,
} from './consumers/EInvoiceEventConsumer.js';
import { createGstComplianceOrchestrator } from './domain/GstComplianceSaga.js';

initializeTelemetry({ serviceName: 'gst-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['GST_SERVICE_PORT'] ?? '3018', 10);
  const config = await loadConfigWithSecrets('gst-service');
  const databaseUrl = config.databaseUrl;
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'gst-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'gst-service',
    serviceName: 'gst-service',
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  ctxFactory.subscribeTenantStatusInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  // ── Kafka event consumers ─────────────────────────────────────────────────
  const kafka = new Kafka({
    clientId: 'gst-service-consumer',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
  });

  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });

  // PG-006: the first registered saga type — e-Invoice IRN generation followed by
  // (conditionally) e-Way Bill generation, compensable as one unit instead of two
  // independent fire-and-forget NIC calls. Registered once here so both the
  // Kafka-triggered run() below and this process's own admin retry()/compensate()
  // resolve the same step list.
  const gstComplianceSaga = createGstComplianceOrchestrator(consumerDb);

  const eventDispatcher: EventHandler = async (event, db) => {
    switch (event.eventType) {
      case 'INVOICE_CONFIRMED':
        await handleInvoiceConfirmed(event, db);
        await handleInvoiceConfirmedForEinvoice(event, db, gstComplianceSaga);
        break;
      case 'INVOICE_CANCELLED':
        await handleInvoiceCancelledForEinvoice(event, db);
        break;
      case 'SALE_RETURN_APPROVED':
        await handleSaleReturnApproved(event, db);
        break;
      case 'GRN_APPROVED':
        await handleGRNApproved(event, db);
        break;
      case 'PURCHASE_RETURN_APPROVED':
        await handlePurchaseReturnApproved(event, db);
        break;
      default:
        logger.warn({ eventType: event.eventType }, 'Unhandled event type in gst consumer');
    }
  };

  const gstTopics = [
    'erp.invoice.confirmed',
    'erp.invoice.cancelled',
    'erp.sale.return.approved',
    'erp.grn.approved',
    'erp.purchase.return.approved',
  ];

  const { PlatformEventConsumer } = await import('@erp/sdk');
  const consumer = new PlatformEventConsumer(kafka, 'gst-service-group', 'gst-service');
  await consumer.subscribe(
    gstTopics,
    eventDispatcher,
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({}, 'GST Kafka consumers started');

  // ── Fastify HTTP server ───────────────────────────────────────────────────
  const metricsHandler = await createMetricsHandler('gst-service');

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'gst-service', logger);

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    methods: CORS_METHODS,
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
  fastify.addHook('onResponse', createHttpMetricsHook('gst-service'));

  registerHealthRoute(fastify, 'gst-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
    kafka: () => checkKafka(kafka),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // Seed HSN master on startup (idempotent) — global table, uses direct db
  try {
    const db = createDatabaseClient({ url: databaseUrl });
    await db
      .insert(hsnMaster)
      .values(
        HSN_SEED_DATA.map((row) => ({
          hsnCode: row.hsnCode,
          description: row.description,
          gstRate: row.gstRate,
          cessRate: row.cessRate,
          chapter: row.chapter,
          heading: row.heading,
        }))
      )
      .onConflictDoNothing();
    logger.info({ count: HSN_SEED_DATA.length }, 'HSN master seed complete');
  } catch (err) {
    logger.error({ err }, 'HSN seed failed (non-fatal)');
  }

  await fastify.register(
    async (sub) => {
      await gstRoutes(sub, ctxFactory);
      await gstRegisterRoutes(sub, ctxFactory);
      await gstr1Routes(sub, ctxFactory);
      await gstr3bRoutes(sub, ctxFactory);
      await gstr9Routes(sub, ctxFactory);
      await rcmRoutes(sub, ctxFactory);
      await einvoiceRoutes(sub, ctxFactory);
      await ewayBillRoutes(sub, ctxFactory);
      await gstr2aRoutes(sub, ctxFactory);
      await gstReturnsRoutes(sub, ctxFactory);
      await internalRoutes(sub, ctxFactory, gstComplianceSaga, consumerDb);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'GST service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
