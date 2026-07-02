/**
 * ERP custom Prometheus metrics — Phase 13 (Monitoring Completeness / Task 13.6)
 *
 * Defines all ERP-domain counters and gauges referenced in the Grafana dashboard
 * and Prometheus alert rules (alert-rules.yml).
 *
 * Services import the metrics they need and call .inc() / .set() at the
 * appropriate call sites. The prom-client default registry is shared, so
 * Prometheus scrapes all metrics from a single /metrics endpoint per service.
 */

import {
  Counter,
  Gauge,
  collectDefaultMetrics,
  type Registry,
} from 'prom-client';

// ─── Invoice metrics (sales-service) ────────────────────────────────────────

export const erpInvoiceCreateTotal = new Counter({
  name: 'erp_invoice_create_total',
  help: 'Total number of invoices successfully created',
  labelNames: ['tenant_id', 'branch_id'],
});

export const erpInvoiceCreateFailedTotal = new Counter({
  name: 'erp_invoice_create_failed_total',
  help: 'Total number of invoice creation attempts that failed',
  labelNames: ['tenant_id', 'reason'],
});

// ─── Saga metrics (sales-service / event-service) ───────────────────────────

export const erpSagaActiveCount = new Gauge({
  name: 'erp_saga_active_count',
  help: 'Number of sagas currently in-flight (not yet COMPLETED or COMPENSATED)',
  labelNames: ['saga_type'],
});

export const erpSagaStalledCount = new Gauge({
  name: 'erp_saga_stalled_count',
  help: 'Number of sagas that have been in-flight for > 30 minutes without progressing',
  labelNames: ['saga_type'],
});

export const erpSagaFailedTotal = new Counter({
  name: 'erp_saga_failed_total',
  help: 'Total number of sagas that reached FAILED terminal state',
  labelNames: ['saga_type'],
});

export const erpSagaCompensationTotal = new Counter({
  name: 'erp_saga_compensation_total',
  help: 'Total number of saga compensations triggered',
  labelNames: ['saga_type'],
});

// ─── Outbox / DLQ metrics (platform-sdk OutboxPublisher) ────────────────────

export const erpDlqDepth = new Gauge({
  name: 'erp_dlq_depth',
  help: 'Number of events in the dead-letter queue (publish failures after max retries)',
  labelNames: ['event_type'],
});

export const erpOutboxPendingCount = new Gauge({
  name: 'erp_outbox_pending_count',
  help: 'Number of outbox events not yet published to Kafka',
});

// ─── Inventory metrics (inventory-service) ──────────────────────────────────

export const erpStockAvailableQty = new Gauge({
  name: 'erp_stock_available_qty',
  help: 'Current available quantity for a tracked item in a warehouse',
  labelNames: ['tenant_id', 'item_id', 'warehouse_id'],
});

export const erpStockNegativeTotal = new Counter({
  name: 'erp_stock_negative_total',
  help: 'Total number of times stock went negative — should always be 0 in production',
  labelNames: ['tenant_id', 'item_id'],
});

// ─── Auth metrics (auth-service) ────────────────────────────────────────────

export const erpAuthLoginTotal = new Counter({
  name: 'erp_auth_login_total',
  help: 'Total login attempts',
  labelNames: ['tenant_id', 'outcome'], // outcome: 'success' | 'failed' | 'locked'
});

export const erpAuthBruteForceTotal = new Counter({
  name: 'erp_auth_brute_force_total',
  help: 'Total accounts locked due to brute force',
  labelNames: ['tenant_id'],
});

// ─── HTTP API metrics (all services) ────────────────────────────────────────

export const erpHttpRequestTotal = new Counter({
  name: 'erp_http_request_total',
  help: 'Total HTTP requests handled by this service',
  labelNames: ['method', 'route', 'status_code'],
});

export const erpHttpErrorTotal = new Counter({
  name: 'erp_http_error_total',
  help: 'Total 5xx HTTP errors returned by this service',
  labelNames: ['method', 'route'],
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
  collectDefaultMetrics({
    labels: {
      service: serviceName,
      env: process.env['NODE_ENV'] ?? 'development',
    },
    register: registry,
  });
}
