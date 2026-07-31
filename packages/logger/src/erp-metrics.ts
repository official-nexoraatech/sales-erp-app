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

function getOrCreateCounter<T extends string>(
  config: ConstructorParameters<typeof Counter<T>>[0]
): Counter<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Counter<T>;
  return new Counter(config);
}

function getOrCreateGauge<T extends string>(
  config: ConstructorParameters<typeof Gauge<T>>[0]
): Gauge<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Gauge<T>;
  return new Gauge(config);
}

function getOrCreateHistogram<T extends string>(
  config: ConstructorParameters<typeof Histogram<T>>[0]
): Histogram<T> {
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
  help: 'Number of PENDING events in the dead-letter queue, by topic',
  // Labeled by 'topic' (not 'event_type') to match the existing DLQDepthHigh alert rule
  // (`sum(erp_dlq_depth) by (topic)`) and the erp-hardening Grafana panel's legendFormat
  // ("{{ topic }}") in infrastructure/docker/prometheus/alert-rules.yml — both were already
  // written against this label name before this gauge was ever set anywhere.
  labelNames: ['topic'],
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

// ─── Scheduled job metrics (scheduler-service JobRegistry) ─────────────────
// Until now, none of scheduler-service's 44 registered cron jobs emitted any metric at all —
// job success/failure/duration was only ever visible in service logs, not Prometheus/Grafana/
// Alertmanager, unlike every other subsystem in this file. tenant_id is deliberately NOT a
// label here (unlike erpInvoiceCreateTotal etc.) — job_name × status is already ~130+ series
// across 44 jobs, and multiplying that by tenant count risks real cardinality blowup for
// tenant-scoped jobs that run once per active tenant.

export const erpJobExecutionTotal = getOrCreateCounter({
  name: 'erp_job_execution_total',
  help: 'Total scheduled job executions by outcome',
  labelNames: ['job_name', 'status'], // status: 'completed' | 'failed' | 'skipped'
});

export const erpJobDurationSeconds = getOrCreateHistogram({
  name: 'erp_job_duration_seconds',
  help: 'Duration of scheduled job executions in seconds',
  labelNames: ['job_name'],
  buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 300, 900],
});

export const erpJobLastSuccessTimestamp = getOrCreateGauge({
  name: 'erp_job_last_success_timestamp',
  help: 'Unix timestamp of the last successful completion of a scheduled job',
  labelNames: ['job_name'],
});

// ─── Search-service metrics ─────────────────────────────────────────────────
// Search-service's DLQ entries already surface through the shared erpDlqDepth gauge above
// (dlq_items isn't scoped by consumer, so event-service's OutboxRelayWorker.refreshGauges()
// already counts them) — these two are what that shared gauge can't show: failure *rate* by
// event type (a DLQ item disappears once retried/discarded, so depth alone hides history),
// and reindex/bulk-index document outcomes, both previously visible only in service logs.

export const erpSearchSyncFailureTotal = getOrCreateCounter({
  name: 'erp_search_sync_failure_total',
  help: 'Total search-index sync failures in the Kafka consumer, by event type',
  labelNames: ['event_type'],
});

export const erpSearchReindexTotal = getOrCreateCounter({
  name: 'erp_search_reindex_total',
  help: 'Total documents processed by search-service reindex/bulk-index calls, by entity and outcome',
  labelNames: ['entity', 'outcome'], // outcome: 'indexed' | 'failed'
});

// ─── Bootstrap helper ────────────────────────────────────────────────────────

/**
 * Initialize default Node.js metrics (memory, CPU, event loop, GC)
 * and register ERP metrics on the given registry (or the default global registry).
 * Call once per service at startup.
 */
export function initializeErpMetrics(serviceName: string, registry?: Registry): void {
  const config: Parameters<typeof collectDefaultMetrics>[0] = {
    labels: {
      service: serviceName,
      env: process.env['NODE_ENV'] ?? 'development',
    },
  };
  if (registry) config.register = registry;
  collectDefaultMetrics(config);
}
