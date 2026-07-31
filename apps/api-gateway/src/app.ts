import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import httpProxy from '@fastify/http-proxy';
import compress from '@fastify/compress';
import {
  HELMET_OPTIONS,
  CORS_METHODS,
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
import { gatewayAuthDecorate, gatewayAuthReject } from './middleware/gateway-auth.js';
import { UpstreamCircuitBreaker } from './upstream-circuit-breaker.js';

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

  // Fixes F8 (2026-07-23 API Gateway audit): @fastify/http-proxy streams the raw request
  // body straight through to the upstream — it does not go through Fastify's own
  // body-parsing pipeline, so Fastify's `bodyLimit` option never applies to proxied routes
  // no matter what it's set to (confirmed empirically: a 30MB payload passed through this
  // gateway completely unbounded before this fix). No service in this codebase overrides
  // Fastify's own default 1MB bodyLimit either, so nothing today can successfully push more
  // than that through any backend service anyway — this just moves that same, already-
  // effective ceiling to the front door, so an oversized payload is rejected before it
  // consumes gateway bandwidth/memory for nothing on its way to a backend that would reject
  // it anyway.
  //
  // Known limitation: this checks the declared Content-Length header. A request using
  // chunked transfer-encoding (no upfront declared length) would not carry one and would
  // still stream through unbounded — Content-Length is what this codebase's normal JSON-body
  // API traffic always sends, so this is a practical mitigation, not an absolute guarantee.
  const MAX_PROXIED_BODY_BYTES = 1024 * 1024; // 1MB — matches Fastify's own unconfigured default
  fastify.addHook('onRequest', async (request, reply) => {
    const contentLength = request.headers['content-length'];
    if (contentLength !== undefined && Number(contentLength) > MAX_PROXIED_BODY_BYTES) {
      void reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds the ${MAX_PROXIED_BODY_BYTES} byte limit`,
        },
      });
    }
  });

  // Fixes F5 (2026-07-23 API Gateway audit): no service in this codebase compresses its own
  // responses (none register @fastify/compress) — added here once, centrally, rather than in
  // 14 places. global: true compresses any response the client's Accept-Encoding allows,
  // including proxied/streamed ones (@fastify/http-proxy's default response handling is a
  // stream, which this plugin supports natively); it does not affect an upstream response
  // that's already Content-Encoding-compressed (none are, today, but the plugin's own default
  // behavior already skips re-compressing an already-encoded body regardless).
  await fastify.register(compress, { global: true });

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
  await fastify.register(cors, {
    methods: CORS_METHODS,
    origin: config.allowedOrigins,
    credentials: true,
  });

  // global: false — deliberate. @fastify/rate-limit's `global: true` mode always attaches
  // its check as a route-level hook (via an internal onRoute listener), and Fastify always
  // runs route-level hooks after every instance-level `fastify.addHook()` of the same phase,
  // regardless of the order register()/addHook() calls appear in this file — so `hook:
  // 'preHandler'` alone cannot be interleaved between gatewayAuthDecorate and
  // gatewayAuthReject below (confirmed by a failing test before this comment was written).
  // `fastify.rateLimit()` (decorator this plugin adds) returns the same check as a plain
  // handler function instead, which this file can place at the exact point in its own
  // instance-level preHandler chain via addHook, giving real control over ordering.
  await fastify.register(rateLimit, {
    global: false,
    ...RATE_LIMIT_DEFAULTS,
    keyGenerator: tenantOrIpKeyGenerator,
  });

  // These three preHandler steps must run in exactly this order — see gateway-auth.ts for
  // the full rationale (fixes F1, 2026-07-23 API Gateway audit): decorate (verify + attach
  // request.auth, never rejects) so the rate limiter can key by tenant when the token is
  // genuinely valid; rate-limit (still IP-keyed, and still enforced, for anyone with a
  // missing/invalid token — floods aren't exempted, just bucketed differently); reject
  // (401s non-exempt paths that still have no verified request.auth after the above).
  fastify.addHook('preHandler', gatewayAuthDecorate);
  fastify.addHook('preHandler', fastify.rateLimit());
  fastify.addHook('preHandler', gatewayAuthReject);

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

  // Fixes F3 (2026-07-23 API Gateway audit): previously a dead/slow upstream just meant
  // every request timed out against it individually, repeatedly, with no fast-fail —
  // inconsistent with every direct service-to-service call in this codebase, which already
  // uses packages/platform-sdk/src/circuitBreaker.ts's createCircuitBreaker. That helper
  // wraps a single async action's own call — @fastify/http-proxy has no equivalent seam
  // (it manages its own HTTP forwarding internally), so this uses a small external-signal
  // breaker (upstream-circuit-breaker.ts) driven by real proxied-request outcomes instead.
  const breaker = new UpstreamCircuitBreaker();
  // Tracks, per in-flight request, why it didn't get a normal pass-through response — read
  // by the onResponse hook below to decide whether to record a breaker success. Deliberately
  // NOT inferred from reply.statusCode (a live, reachable upstream could legitimately return
  // its own 502/503 for unrelated reasons); explicit marking avoids that false signal. Keyed
  // by `object` rather than a specific FastifyRequest generic — the request objects seen
  // inside @fastify/http-proxy's onError carry a slightly different type parameterization
  // than the plugin's own preHandler/onResponse hooks; only identity matters here, not any
  // property access, so a looser key type sidesteps that mismatch cleanly.
  const proxyOutcome = new WeakMap<object, 'circuit-rejected' | 'proxy-failed'>();

  for (const upstream of config.upstreams) {
    // Child scope per upstream so the breaker's gate/tracking hooks apply only to this one
    // service's proxy routes — the same encapsulation technique this codebase already uses
    // elsewhere to scope a hook to a subset of routes (e.g. every service's own
    // authenticate/requirePermission child-plugin pattern), rather than a single global hook
    // that would need to re-derive which upstream each request belongs to.
    await fastify.register(async (scope) => {
      scope.addHook('preHandler', async (request, reply) => {
        if (!breaker.allowRequest(upstream.service)) {
          proxyOutcome.set(request, 'circuit-rejected');
          void reply.code(503).send({
            error: {
              code: 'UPSTREAM_UNAVAILABLE',
              message: `${upstream.service}-service is temporarily unavailable (circuit open after repeated failures) — retry shortly`,
            },
          });
        }
      });
      scope.addHook('onResponse', async (request) => {
        // undefined means neither branch below ran: a genuine pass-through response was
        // received from the real upstream (any status code — even the upstream's own 4xx/5xx
        // still proves it was reachable, which is the only thing this breaker tracks).
        if (proxyOutcome.get(request) === undefined) {
          breaker.recordSuccess(upstream.service);
        }
        proxyOutcome.delete(request);
      });
      await scope.register(httpProxy, {
        upstream: upstream.target,
        prefix: upstream.prefix,
        rewritePrefix: upstream.rewritePrefix,
        replyOptions: {
          onError: (reply, { error }) => {
            logger.error(
              { err: error.message, upstream: upstream.service },
              'Upstream proxy error'
            );
            proxyOutcome.set(reply.request, 'proxy-failed');
            breaker.recordFailure(upstream.service);
            void reply.code(502).send({
              error: {
                code: 'UPSTREAM_UNAVAILABLE',
                message: `${upstream.service}-service is unreachable`,
              },
            });
          },
        },
      });
    });
  }

  return fastify;
}
