// Prometheus-compatible metrics helpers — services expose /metrics via Fastify
// Uses prom-client for scraping by Prometheus

import { erpHttpRequestTotal, erpHttpErrorTotal, erpHttpRequestDuration } from './erp-metrics.js';

export interface MetricsOptions {
  serviceName: string;
  defaultLabels?: Record<string, string>;
}

// Structural — avoids a hard dependency on fastify's types from this framework-agnostic package.
export interface MetricsHookRequest {
  method: string;
  url: string;
  routeOptions: { url: string | undefined };
}
export interface MetricsHookReply {
  statusCode: number;
  elapsedTime: number;
}

// Returns an onResponse hook handler for the ES-16 standard metrics: request count,
// 5xx error count, and duration histogram. Register it directly —
// `fastify.addHook('onResponse', createHttpMetricsHook(serviceName))` — since
// Fastify's own addHook overloads don't structurally match a generic wrapper.
export function createHttpMetricsHook(
  serviceName: string
): (request: MetricsHookRequest, reply: MetricsHookReply) => void {
  return (request, reply) => {
    const method = request.method;
    const route = request.routeOptions?.url ?? request.url;
    const status = String(reply.statusCode);

    erpHttpRequestTotal.inc({ method, route, status_code: status });
    erpHttpRequestDuration.observe(
      { method, route, status_code: status, service: serviceName },
      reply.elapsedTime / 1000
    );
    if (reply.statusCode >= 500) {
      erpHttpErrorTotal.inc({ method, route });
    }
  };
}

// Returns a Fastify-compatible route handler that serves Prometheus metrics
// Import prom-client in the service that uses this
export async function createMetricsHandler(serviceName: string): Promise<{
  contentType: string;
  handler: () => Promise<string>;
}> {
  // Dynamic import to avoid bundling prom-client into all packages
  const { collectDefaultMetrics, register } = await import('prom-client');

  collectDefaultMetrics({
    labels: { service: serviceName, env: process.env['NODE_ENV'] ?? 'development' },
  });

  return {
    contentType: register.contentType,
    handler: async () => register.metrics(),
  };
}
