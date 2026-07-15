import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import httpProxy from '@fastify/http-proxy';
import {
  HELMET_OPTIONS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  RATE_LIMIT_DEFAULTS,
  registerErrorHandler,
} from '@erp/sdk';
import type { HealthCheckFn } from '@erp/sdk';
import { createMetricsHandler, createHttpMetricsHook, createCorrelationIdHook } from '@erp/logger';
import type { StructuredLogger } from '@erp/logger';
import type { GatewayConfig } from './config.js';
import { gatewayAuthPreHandler } from './middleware/gateway-auth.js';

const UPSTREAM_HEALTH_TIMEOUT_MS = 2000;

async function checkUpstream(target: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${target}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// Builds and registers the gateway app (helmet/cors/rate-limit/health/proxy routes)
// without calling listen() — kept separate from main.ts's bootstrap() so tests can
// exercise routing/auth behavior via app.inject() against real local upstream
// servers instead of binding real ports.
export async function buildGateway(
  config: GatewayConfig,
  logger: StructuredLogger
): Promise<FastifyInstance> {
  const metricsHandler = await createMetricsHandler('api-gateway');

  const fastify = Fastify({ logger: false, trustProxy: true });

  // Must be registered before any routes/plugins — see auth-service/src/main.ts for why
  // (setErrorHandler only propagates to encapsulated child contexts that exist when it's set).
  registerErrorHandler(fastify, 'api-gateway', logger);

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await fastify.register(rateLimit, {
    global: true,
    ...RATE_LIMIT_DEFAULTS,
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('api-gateway'));

  const upstreamChecks: Record<string, HealthCheckFn> = {};
  for (const upstream of config.upstreams) {
    upstreamChecks[upstream.service] = () => checkUpstream(upstream.target);
  }
  registerHealthRoute(fastify, 'api-gateway', upstreamChecks);

  fastify.get('/metrics', async (_req, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  fastify.addHook('preHandler', gatewayAuthPreHandler);

  for (const upstream of config.upstreams) {
    await fastify.register(httpProxy, {
      upstream: upstream.target,
      prefix: upstream.prefix,
      rewritePrefix: upstream.rewritePrefix,
      replyOptions: {
        onError: (reply, { error }) => {
          logger.error({ err: error.message, upstream: upstream.service }, 'Upstream proxy error');
          void reply.code(502).send({
            error: {
              code: 'UPSTREAM_UNAVAILABLE',
              message: `${upstream.service}-service is unreachable`,
            },
          });
        },
      },
    });
  }

  return fastify;
}
