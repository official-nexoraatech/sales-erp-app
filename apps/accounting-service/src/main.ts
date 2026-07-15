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
import { costCenterRoutes } from './api/cost-centers.routes.js';
import { searchSyncInternalRoutes } from './api/search-sync.internal.routes.js';
import { schedulerInternalRoutes } from './api/scheduler-internal.routes.js';
import {
  handleInvoiceConfirmed,
  handleInvoiceCancelled,
} from './consumers/InvoiceAccountingConsumer.js';
import { handleGRNApproved } from './consumers/GRNAccountingConsumer.js';
import { handleCogsCalculated } from './consumers/CogsAccountingConsumer.js';
import {
  handlePaymentReceived,
  handleSupplierPaymentMade,
  handleChequeBounced,
} from './consumers/PaymentAccountingConsumer.js';
import { handleSaleReturnApproved } from './consumers/SaleReturnAccountingConsumer.js';
import { handleExpenseApproved, handleExpensePaid } from './consumers/ExpenseAccountingConsumer.js';
import {
  handlePayrollRunApproved,
  handlePayrollRunDisbursed,
} from './consumers/PayrollAccountingConsumer.js';
import { handleEmployeeLoanDisbursed } from './consumers/EmployeeLoanAccountingConsumer.js';
import { handleRcmLiabilityPosted } from './consumers/RcmAccountingConsumer.js';

initializeTelemetry({ serviceName: 'accounting-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['ACCOUNTING_SERVICE_PORT'] ?? '3019', 10);
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'accounting-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });
  const config = await loadConfigWithSecrets('accounting-service');
  const databaseUrl = config.databaseUrl;

  const ctxFactory = new PlatformContextFactory({
    databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    kafkaClientId: 'accounting-service',
    serviceName: 'accounting-service',
  });
  await ctxFactory.connect();
  ctxFactory.subscribeFeatureFlagInvalidations();
  ctxFactory.subscribeTenantStatusInvalidations();
  initTenantStatusEnforcement(ctxFactory.rawDb);

  // ── Kafka event consumers ─────────────────────────────────────────────────
  const kafka = new Kafka({
    clientId: 'accounting-service-consumer',
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
  });

  // Shared db for consumer (separate connection from request pool)
  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });

  const eventDispatcher: EventHandler = async (event, db) => {
    switch (event.eventType) {
      case 'INVOICE_CONFIRMED':
        await handleInvoiceConfirmed(event, db);
        break;
      case 'INVOICE_CANCELLED':
        await handleInvoiceCancelled(event, db);
        break;
      case 'GRN_APPROVED':
        await handleGRNApproved(event, db);
        break;
      case 'COGS_CALCULATED':
        await handleCogsCalculated(event, db);
        break;
      case 'PAYMENT_RECEIVED':
        await handlePaymentReceived(event, db);
        break;
      case 'SUPPLIER_PAYMENT_MADE':
        await handleSupplierPaymentMade(event, db);
        break;
      case 'CHEQUE_BOUNCED':
        await handleChequeBounced(event, db);
        break;
      case 'SALE_RETURN_APPROVED':
        await handleSaleReturnApproved(event, db);
        break;
      case 'EXPENSE_APPROVED':
        await handleExpenseApproved(event, db);
        break;
      case 'EXPENSE_PAID':
        await handleExpensePaid(event, db);
        break;
      case 'PAYROLL_RUN_APPROVED':
        await handlePayrollRunApproved(event, db);
        break;
      case 'PAYROLL_RUN_DISBURSED':
        await handlePayrollRunDisbursed(event, db);
        break;
      case 'EMPLOYEE_LOAN_DISBURSED':
        await handleEmployeeLoanDisbursed(event, db);
        break;
      case 'RCM_LIABILITY_POSTED':
        await handleRcmLiabilityPosted(event, db);
        break;
      default:
        logger.warn({ eventType: event.eventType }, 'Unhandled event type in accounting consumer');
    }
  };

  const topics = [
    'erp.invoice.confirmed',
    'erp.invoice.cancelled',
    'erp.grn.approved',
    'erp.cogs.calculated',
    'erp.payment.received',
    'erp.supplier.payment.made',
    'erp.cheque.bounced',
    'erp.sale.return.approved',
    'erp.expense.approved',
    'erp.expense.paid',
    'erp.payroll.run.approved',
    'erp.payroll.run.disbursed',
    'erp.employee.loan.disbursed',
    'erp.rcm.liability.posted',
  ];

  const consumer = new PlatformEventConsumer(
    kafka,
    'accounting-service-group',
    'accounting-service'
  );
  await consumer.subscribe(
    topics,
    eventDispatcher,
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({}, 'Accounting Kafka consumers started');

  // ── Fastify HTTP server ───────────────────────────────────────────────────
  const metricsHandler = await createMetricsHandler('accounting-service');

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'accounting-service', logger);

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
  fastify.addHook('onResponse', createHttpMetricsHook('accounting-service'));

  registerHealthRoute(fastify, 'accounting-service', {
    db: () => ctxFactory.checkDb(),
    redis: () => ctxFactory.checkRedis(),
    kafka: () => checkKafka(kafka),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  await fastify.register(
    async (sub) => {
      await accountRoutes(sub, ctxFactory);
      await openingBalancesRoutes(sub, ctxFactory);
      await journalRoutes(sub, ctxFactory);
      await reportsRoutes(sub, ctxFactory);
      await bankRoutes(sub, ctxFactory);
      await financialYearRoutes(sub, ctxFactory);
      await fixedAssetsRoutes(sub, ctxFactory);
      await tdsRoutes(sub, ctxFactory);
      await postingMatrixRoutes(sub, ctxFactory);
      await costCenterRoutes(sub, ctxFactory);
      // Reuses the consumer's own db connection — internal-only, guarded by x-internal-key
      // rather than a tenant-scoped ctx, so it doesn't need PlatformContextFactory.
      await searchSyncInternalRoutes(sub, consumerDb);
      await schedulerInternalRoutes(sub, ctxFactory);
    },
    { prefix: '/api/v2' }
  );

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Accounting service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

export {};
