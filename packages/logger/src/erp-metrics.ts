/**
 * ERP custom Prometheus metrics — Phase 13 (Monitoring Completeness / Task 13.6)
 *
 * Defines all ERP-domain counters and gauges referenced in the Grafana dashboard
 * and Prometheus alert rules (alert-rules.yml).
 *
 * Services import the metrics they need and call .inc() / .set() at the
 * appropriate call sites. The prom-client default registry is shared, so
 * Prometheus scrapes all metrics from a single /metrics endpoint per service.
 *
 * Registration goes through getOrCreate*() (idempotent, keyed by metric name) rather
 * than `new Counter(...)` directly — this module is re-imported fresh per Vitest test
 * file, but the underlying prom-client default registry persists across those imports
 * within the same worker process, so a plain `new Counter(...)` throws "already
 * registered" as soon as a second test file in the same package imports this module.
 */

import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  register,
  type Registry,
} from 'prom-client';

function getOrCreateCounter<T extends string>(config: ConstructorParameters<typeof Counter<T>>[0]): Counter<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Counter<T>;
  return new Counter(config);
}

function getOrCreateGauge<T extends string>(config: ConstructorParameters<typeof Gauge<T>>[0]): Gauge<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Gauge<T>;
  return new Gauge(config);
}

function getOrCreateHistogram<T extends string>(config: ConstructorParameters<typeof Histogram<T>>[0]): Histogram<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Histogram<T>;
  return new Histogram(config);
}

// ─── Invoice metrics (sales-service) ────────────────────────────────────────

export const erpInvoiceCreateTotal = getOrCreateCounter({
  name: 'erp_invoice_create_total',
  help: 'Total number of invoices successfully created',
  labelNames: ['tenant_id', 'branch_id'],
});

export const erpInvoiceCreateFailedTotal = getOrCreateCounter({
  name: 'erp_invoice_create_failed_total',
  help: 'Total number of invoice creation attempts that failed',
  labelNames: ['tenant_id', 'reason'],
});

// ─── Saga metrics (sales-service / event-service) ───────────────────────────

export const erpSagaActiveCount = getOrCreateGauge({
  name: 'erp_saga_active_count',
  help: 'Number of sagas currently in-flight (not yet COMPLETED or COMPENSATED)',
  labelNames: ['saga_type'],
});

export const erpSagaStalledCount = getOrCreateGauge({
  name: 'erp_saga_stalled_count',
  help: 'Number of sagas that have been in-flight for > 30 minutes without progressing',
  labelNames: ['saga_type'],
});

export const erpSagaFailedTotal = getOrCreateCounter({
  name: 'erp_saga_failed_total',
  help: 'Total number of sagas that reached FAILED terminal state',
  labelNames: ['saga_type'],
});

export const erpSagaCompensationTotal = getOrCreateCounter({
  name: 'erp_saga_compensation_total',
  help: 'Total number of saga compensations triggered',
  labelNames: ['saga_type'],
});

// ─── Outbox / DLQ metrics (platform-sdk OutboxPublisher) ────────────────────

export const erpDlqDepth = getOrCreateGauge({
  name: 'erp_dlq_depth',
  help: 'Number of events in the dead-letter queue (publish failures after max retries)',
  labelNames: ['event_type'],
});

export const erpOutboxPendingCount = getOrCreateGauge({
  name: 'erp_outbox_pending_count',
  help: 'Number of outbox events not yet published to Kafka',
});

// ─── Inventory metrics (inventory-service) ──────────────────────────────────

export const erpStockAvailableQty = getOrCreateGauge({
  name: 'erp_stock_available_qty',
  help: 'Current available quantity for a tracked item in a warehouse',
  labelNames: ['tenant_id', 'item_id', 'warehouse_id'],
});

export const erpStockNegativeTotal = getOrCreateCounter({
  name: 'erp_stock_negative_total',
  help: 'Total number of times stock went negative — should always be 0 in production',
  labelNames: ['tenant_id', 'item_id'],
});

// ─── Auth metrics (auth-service) ────────────────────────────────────────────

export const erpAuthLoginTotal = getOrCreateCounter({
  name: 'erp_auth_login_total',
  help: 'Total login attempts',
  labelNames: ['tenant_id', 'outcome'], // outcome: 'success' | 'failed' | 'locked'
});

export const erpAuthBruteForceTotal = getOrCreateCounter({
  name: 'erp_auth_brute_force_total',
  help: 'Total accounts locked due to brute force',
  labelNames: ['tenant_id'],
});

// ─── Tenant lifecycle metrics (platform-sdk assertTenantActive, PG-012) ─────

export const erpTenantBlockedRequestsTotal = getOrCreateCounter({
  name: 'erp_tenant_blocked_requests_total',
  help: 'Total requests rejected because the tenant is SUSPENDED or CLOSED',
  labelNames: ['tenant_id', 'status'],
});

// ─── HTTP API metrics (all services) ────────────────────────────────────────

export const erpHttpRequestTotal = getOrCreateCounter({
  name: 'erp_http_request_total',
  help: 'Total HTTP requests handled by this service',
  labelNames: ['method', 'route', 'status_code'],
});

export const erpHttpErrorTotal = getOrCreateCounter({
  name: 'erp_http_error_total',
  help: 'Total 5xx HTTP errors returned by this service',
  labelNames: ['method', 'route'],
});

// ES-16: request-duration histogram, labeled per-service so one Grafana panel spans all services
export const erpHttpRequestDuration = getOrCreateHistogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ─── Outbox relay metrics (ES-16) ────────────────────────────────────────────

export const erpOutboxRelayTotal = getOrCreateCounter({
  name: 'outbox_relay_total',
  help: 'Total outbox events relayed to Kafka',
  labelNames: ['tenant_id', 'event_type'],
});

// ─── Read-replica routing metrics (PG-005, packages/db-client ReplicaRouter) ───

export const erpReplicaFallbackTotal = getOrCreateCounter({
  name: 'erp_replica_fallback_total',
  help: 'Total times ReplicaRouter.forRead() fell back to the primary due to replica lag/failure',
  labelNames: ['service'],
});

// ─── Bootstrap helper ────────────────────────────────────────────────────────

/**
 * Initialize default Node.js metrics (memory, CPU, event loop, GC)
 * and register ERP metrics on the given registry (or the default global registry).
 * Call once per service at startup.
 */
export function initializeErpMetrics(
  serviceName: string,
  registry?: Registry
): void {
  const config: Parameters<typeof collectDefaultMetrics>[0] = {
    labels: {
      service: serviceName,
      env: process.env['NODE_ENV'] ?? 'development',
    },
  };
  if (registry) config.register = registry;
  collectDefaultMetrics(config);
}
