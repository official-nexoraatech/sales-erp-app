import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Kafka } from 'kafkajs';
import Redis from 'ioredis';
import { createDatabaseClient, dlqItems } from '@erp/db';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadConfigWithSecrets } from '@erp/config';
import type { ERPEventPayload } from '@erp/types';
import {
  HELMET_OPTIONS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  initializeTelemetry,
  initTenantStatusEnforcement,
  subscribeToTenantStatusInvalidations,
  PlatformEventConsumer,
  TenantScopedDatabase,
  checkKafka,
  registerErrorHandler,
} from '@erp/sdk';
import { SearchEngine } from './domain/SearchEngine.js';
import { searchRoutes } from './api/search.routes.js';
import { internalRoutes } from './api/internal.routes.js';
import { savedSearchesRoutes } from './api/saved-searches.routes.js';
import { searchAnalyticsRoutes } from './api/search-analytics.routes.js';
import { deadLettersRoutes } from './api/dead-letters.routes.js';
import { syncSearchIndex } from './consumers/SearchSyncConsumer.js';
import { SEARCH_SYNC_TOPICS, topicForEventType } from './consumers/eventEntityMap.js';

initializeTelemetry({ serviceName: 'search-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SEARCH_SERVICE_PORT'] ?? '3017', 10);
  const config = await loadConfigWithSecrets('search-service');
  const elasticsearchUrl = config.elasticsearchUrl;
  const apiKey = process.env['ELASTICSEARCH_API_KEY'];

  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'search-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  const searchEngine = new SearchEngine({
    elasticsearchUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
  });
  const metricsHandler = await createMetricsHandler('search-service');

  // ── Kafka consumer — keeps Elasticsearch in sync with every other service's writes ──
  const databaseUrl = config.databaseUrl;
  const kafkaBrokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(',');
  const kafka = new Kafka({ clientId: 'search-service-consumer', brokers: kafkaBrokers });
  // search-service's only DB dependency: the shared dlq_items table for failed index
  // syncs (Phase 3) — everything else stays Elasticsearch-only, no reach into other
  // services' schemas.
  const consumerDb = createDatabaseClient({ url: databaseUrl, maxConnections: 3 });
  initTenantStatusEnforcement(consumerDb);

  // Dedicated to tenant-status pub/sub invalidation only — this service otherwise has no
  // Redis-backed caching or rate-limiting.
  const tenantStatusRedis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  tenantStatusRedis.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis connection error in search-service');
  });
  subscribeToTenantStatusInvalidations(tenantStatusRedis);

  const eventDispatcher = async (event: ERPEventPayload): Promise<void> => {
    try {
      await syncSearchIndex(event, searchEngine);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: errMsg, eventType: event.eventType, aggregateId: event.aggregateId },
        'Failed to sync search index — writing to dead-letter queue'
      );
      await consumerDb.insert(dlqItems).values({
        topic: topicForEventType(event.eventType),
        partition: 0,
        offset: event.eventId,
        payload: event as unknown as Record<string, unknown>,
        // 'consumer' marker: dlq_items is a shared table (OutboxPublisher also writes to it,
        // for cross-service Kafka publish failures) — this is what the Phase 8 dead-letter
        // admin view filters on to show only search-service's own consume-side failures.
        headers: {
          eventType: event.eventType,
          tenantId: String(event.tenantId),
          consumer: 'search-service',
        },
        errorMessage: errMsg,
        retryCount: 0,
        status: 'PENDING',
        tenantId: event.tenantId,
      });
      throw err; // let PlatformEventConsumer's own inbox bookkeeping mark this FAILED too
    }
  };

  const searchConsumer = new PlatformEventConsumer(kafka, 'search-service-group', 'search-service');
  await searchConsumer.subscribe(
    SEARCH_SYNC_TOPICS,
    eventDispatcher,
    (tenantId: number) => new TenantScopedDatabase(tenantId, consumerDb)
  );
  logger.info({ topicCount: SEARCH_SYNC_TOPICS.length }, 'Search-sync Kafka consumer started');

  const fastify = Fastify({ logger: false, trustProxy: true });
  fastify.addHook('onRequest', createCorrelationIdHook());
  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });
  // In-memory rate-limit store (same fallback auth-service uses) — the Redis connection
  // above is dedicated to tenant-status invalidation, not wired up as the rate-limit store.
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('search-service'));

  registerHealthRoute(fastify, 'search-service', {
    elasticsearch: async () => {
      try {
        const res = await fetch(elasticsearchUrl);
        return res.ok;
      } catch {
        return false;
      }
    },
    kafka: () => checkKafka(kafka),
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // PG-010: dual-registered — unprefixed (legacy, deprecation window) and under /api/v2
  // (baseline convention) — until web-frontend/pos-frontend fully migrate to /api/v2.
  const registerSearchRoutes = async (sub: FastifyInstance): Promise<void> => {
    await searchRoutes(sub, searchEngine, consumerDb);
    await internalRoutes(sub, searchEngine);
    await savedSearchesRoutes(sub, consumerDb);
    await searchAnalyticsRoutes(sub, consumerDb);
    await deadLettersRoutes(sub, consumerDb, searchEngine);
  };

  await registerSearchRoutes(fastify);
  await fastify.register(registerSearchRoutes, { prefix: '/api/v2' });

  registerErrorHandler(fastify, 'search-service', logger);

  process.on('SIGTERM', () => {
    fastify.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    fastify.close(() => process.exit(0));
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Search service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
