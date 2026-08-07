import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import {
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  checkDatabase,
  initializeTelemetry,
  initTenantStatusEnforcement,
  subscribeToTenantStatusInvalidations,
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
import { ConversationService } from './domain/ConversationService.js';
import { ClaudeOrchestrator } from './domain/ClaudeOrchestrator.js';
import { copilotRoutes } from './api/copilot.routes.js';

initializeTelemetry({ serviceName: 'ai-copilot-service' });

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['AI_COPILOT_SERVICE_PORT'] ?? '3025', 10);
  const config = await loadConfigWithSecrets('ai-copilot-service', {
    extraSecrets: ['ANTHROPIC_API_KEY'],
  });
  const databaseUrl = config.databaseUrl;
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'ai-copilot-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });
  const db = createDatabaseClient({ url: databaseUrl });
  initTenantStatusEnforcement(db);

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect();
  logger.info({}, 'Redis connected');
  subscribeToTenantStatusInvalidations(redis);

  // Genuinely optional at boot — same posture as NIC_API_KEY for e-Invoice/e-Way Bill: the
  // service starts and every other route works; only actual Copilot conversations fail with
  // a clear error until an administrator provisions the key (Vault in production, .env in dev).
  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'];
  if (!anthropicApiKey) {
    logger.warn(
      {},
      'ANTHROPIC_API_KEY not set — Copilot conversations will fail until provisioned'
    );
  }

  const conversations = new ConversationService(db);
  const orchestrator = new ClaudeOrchestrator(anthropicApiKey, db, conversations);

  const metricsHandler = await createMetricsHandler('ai-copilot-service');

  const fastify = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(fastify, 'ai-copilot-service', logger);
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
  // Copilot calls are expensive (external LLM API) — a tighter budget than the platform
  // default (200/min) is deliberate, not an oversight.
  await fastify.register(rateLimit, {
    global: true,
    max: 30,
    timeWindow: '1 minute',
    redis,
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('ai-copilot-service'));

  registerHealthRoute(fastify, 'ai-copilot-service', {
    db: () => checkDatabase(db),
    redis: async () => {
      try {
        return (await redis.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // Each call below gets its own Fastify encapsulation context, so copilotRoutes' blanket
  // `addHook('preHandler', authenticate)` stays scoped to that child instance and never
  // leaks onto /health or /metrics, which live on the root instance.
  await fastify.register(async (sub) => copilotRoutes(sub, db, orchestrator));
  await fastify.register(async (sub) => copilotRoutes(sub, db, orchestrator), {
    prefix: '/api/v2',
  });

  const gracefulShutdown = async (): Promise<void> => {
    await redis.quit();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void gracefulShutdown();
  });
  process.on('SIGINT', () => {
    void gracefulShutdown();
  });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'AI Copilot service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
