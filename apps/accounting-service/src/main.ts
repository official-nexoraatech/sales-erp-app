import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Kafka } from 'kafkajs';
import { PlatformContextFactory, TenantScopedDatabase, type EventHandler, HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import { createLogger } from '@erp/logger';
import { ERPError } from '@erp/types';
import { requireEnv } from '@erp/config';
import { PlatformEventConsumer } from '@erp/sdk';
import { accountRoutes } from './api/accounts.routes.js';
import { openingBalancesRoutes } from './api/opening-balances.routes.js';
import { journalRoutes } from './api/journal.routes.js';
import { reportsRoutes } from './api/reports.routes.js';
import { bankRoutes } from './api/bank.routes.js';
import { financialYearRoutes } from './api/financial-year.routes.js';
import { fixedAssetsRoutes } from './api/fixed-assets.routes.js';
import { tdsRoutes } from './api/tds.routes.js';
import { postingMatrixRoutes } from './api/posting-matrix.routes.js';
import { handleInvoiceConfirmed, handleInvoiceCancelled } from './consumers/InvoiceAccountingConsumer.js';
import { handleGRNApproved } from './consumers/GRNAccountingConsumer.js';
import { handlePaymentReceived, handleSupplierPaymentMade, handleChequeBounced } from './consumers/PaymentAccountingConsumer.js';
import { handleSaleReturnApproved } from './consumers/SaleReturnAccountingConsumer.js';
import { handleExpenseApproved, handleExpensePaid } from './consumers/ExpenseAccountingConsumer.js';
import { handlePayrollRunApproved, handlePayrollRunDisbursed } from './consumers/PayrollAccountingConsumer.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['ACCOUNTING_SERVICE_PORT'] ?? '3019', 10);
  const logger = createLogger({ serviceName: 'accounting-service', level: 'info' });
  const databaseUrl = requireEnv('DATABASE_URL');

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'accounting-service',
    serviceName: 'accounting-service',
  });
  await ctxFactory.connect();

  // ── Kafka event consumers ─────────────────────────────────────────────────
  const kafka = new Kafka({
    clientId: 'accounting-service-consumer',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
  });

  // Shared db for consumer (separate connection from request pool)
  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });

  const eventDispatcher: EventHandler = async (event, db) => {
    switch (event.eventType) {
      case 'INVOICE_CONFIRMED':  await handleInvoiceConfirmed(event, db); break;
      case 'INVOICE_CANCELLED':  await handleInvoiceCancelled(event, db); break;
      case 'GRN_APPROVED':       await handleGRNApproved(event, db); break;
      case 'PAYMENT_RECEIVED':   await handlePaymentReceived(event, db); break;
      case 'SUPPLIER_PAYMENT_MADE': await handleSupplierPaymentMade(event, db); break;
      case 'CHEQUE_BOUNCED':     await handleChequeBounced(event, db); break;
      case 'SALE_RETURN_APPROVED': await handleSaleReturnApproved(event, db); break;
      case 'EXPENSE_APPROVED':   await handleExpenseApproved(event, db); break;
      case 'EXPENSE_PAID':       await handleExpensePaid(event, db); break;
      case 'PAYROLL_RUN_APPROVED':  await handlePayrollRunApproved(event, db); break;
      case 'PAYROLL_RUN_DISBURSED': await handlePayrollRunDisbursed(event, db); break;
      default:
        logger.warn({ eventType: event.eventType }, 'Unhandled event type in accounting consumer');
    }
  };

  const topics = [
    'erp.invoice.confirmed',
    'erp.invoice.cancelled',
    'erp.grn.approved',
    'erp.payment.received',
    'erp.supplier.payment.made',
    'erp.cheque.bounced',
    'erp.sale.return.approved',
    'erp.expense.approved',
    'erp.expense.paid',
    'erp.payroll.run.approved',
    'erp.payroll.run.disbursed',
  ];

  const consumer = new PlatformEventConsumer(kafka, 'accounting-service-group', 'accounting-service');
  await consumer.subscribe(
    topics,
    eventDispatcher,
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({}, 'Accounting Kafka consumers started');

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
    return reply.code(200).send({ status: 'ok', service: 'accounting-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# accounting-service metrics\n');
  });

  await fastify.register(async (sub) => {
    await accountRoutes(sub, ctxFactory);
    await openingBalancesRoutes(sub, ctxFactory);
    await journalRoutes(sub, ctxFactory);
    await reportsRoutes(sub, ctxFactory);
    await bankRoutes(sub, ctxFactory);
    await financialYearRoutes(sub, ctxFactory);
    await fixedAssetsRoutes(sub, ctxFactory);
    await tdsRoutes(sub, ctxFactory);
    await postingMatrixRoutes(sub, ctxFactory);
  }, { prefix: '/api/v2' });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error in accounting-service');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Accounting service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
