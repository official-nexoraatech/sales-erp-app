// Prometheus-compatible metrics helpers — services expose /metrics via Fastify
// Uses prom-client for scraping by Prometheus

export interface MetricsOptions {
  serviceName: string;
  defaultLabels?: Record<string, string>;
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
