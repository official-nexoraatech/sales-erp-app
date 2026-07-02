import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Kafka } from 'kafkajs';
import { PlatformContextFactory, TenantScopedDatabase, type EventHandler, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { hsnMaster } from '@erp/db';
import { gstRoutes } from './api/gst.routes.js';
import { gstRegisterRoutes } from './api/gst-register.routes.js';
import { gstr1Routes } from './api/gstr1.routes.js';
import { gstr3bRoutes } from './api/gstr3b.routes.js';
import { einvoiceRoutes } from './api/einvoice.routes.js';
import { ewayBillRoutes } from './api/eway-bill.routes.js';
import { gstr2aRoutes } from './api/gstr2a.routes.js';
import { gstReturnsRoutes } from './api/gst-returns.routes.js';
import { HSN_SEED_DATA } from './domain/hsn-seed.js';
import { handleInvoiceConfirmed } from './consumers/InvoiceGstConsumer.js';
import { handleSaleReturnApproved } from './consumers/SaleReturnGstConsumer.js';
import { handleGRNApproved, handlePurchaseReturnApproved } from './consumers/GRNGstConsumer.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['GST_SERVICE_PORT'] ?? '3018', 10);
  const databaseUrl = requireEnv('DATABASE_URL');
  const logger = createLogger({ serviceName: 'gst-service', level: 'info' });

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'gst-service',
    serviceName: 'gst-service',
  });
  await ctxFactory.connect();

  // ── Kafka event consumers ─────────────────────────────────────────────────
  const kafka = new Kafka({
    clientId: 'gst-service-consumer',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
  });

  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });

  const eventDispatcher: EventHandler = async (event, db) => {
    switch (event.eventType) {
      case 'INVOICE_CONFIRMED':       await handleInvoiceConfirmed(event, db); break;
      case 'SALE_RETURN_APPROVED':    await handleSaleReturnApproved(event, db); break;
      case 'GRN_APPROVED':            await handleGRNApproved(event, db); break;
      case 'PURCHASE_RETURN_APPROVED': await handlePurchaseReturnApproved(event, db); break;
      default:
        logger.warn({ eventType: event.eventType }, 'Unhandled event type in gst consumer');
    }
  };

  const gstTopics = [
    'erp.invoice.confirmed',
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
    return reply.code(200).send({ status: 'ok', service: 'gst-service' });
  });

  // Seed HSN master on startup (idempotent) — global table, uses direct db
  try {
    const db = createDatabaseClient({ url: databaseUrl });
    await db.insert(hsnMaster).values(
      HSN_SEED_DATA.map((row) => ({
        hsnCode: row.hsnCode,
        description: row.description,
        gstRate: row.gstRate,
        cessRate: row.cessRate,
        chapter: row.chapter,
        heading: row.heading,
      }))
    ).onConflictDoNothing();
    logger.info({ count: HSN_SEED_DATA.length }, 'HSN master seed complete');
  } catch (err) {
    logger.error({ err }, 'HSN seed failed (non-fatal)');
  }

  await fastify.register(async (sub) => {
    await gstRoutes(sub, ctxFactory);
    await gstRegisterRoutes(sub, ctxFactory);
    await gstr1Routes(sub, ctxFactory);
    await gstr3bRoutes(sub, ctxFactory);
    await einvoiceRoutes(sub, ctxFactory);
    await ewayBillRoutes(sub, ctxFactory);
    await gstr2aRoutes(sub, ctxFactory);
    await gstReturnsRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in gst-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'GST service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
