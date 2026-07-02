import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createLogger } from '@erp/logger';
import { requireEnv } from '@erp/config';
import { ERPError } from '@erp/types';
import { HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { SearchEngine } from './domain/SearchEngine.js';
import { searchRoutes } from './api/search.routes.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env['SEARCH_SERVICE_PORT'] ?? '3017', 10);
  const elasticsearchUrl = requireEnv('ELASTICSEARCH_URL');
  const apiKey = process.env['ELASTICSEARCH_API_KEY'];

  const logger = createLogger({ serviceName: 'search-service', level: 'info' });

  const searchEngine = new SearchEngine({ elasticsearchUrl, ...(apiKey !== undefined ? { apiKey } : {}) });

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
    return reply.code(200).send({ status: 'ok', service: 'search-service' });
  });

  fastify.get('/metrics', async (_req, reply) => {
    return reply.code(200).send('# search-service metrics\n');
  });

  await searchRoutes(fastify, searchEngine);

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    logger.error({ err: error.message, url: request.url }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });

  process.on('SIGTERM', () => { fastify.close(() => process.exit(0)); });
  process.on('SIGINT', () => { fastify.close(() => process.exit(0)); });

  const address = await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ address }, 'Search service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
