/**
 * Scenario 6 — Outbox Relay Throughput
 * Config: 10 VUs sustained invoice creation (~2 min) to flood outbox_events, while a
 * separate low-rate poller VU watches event-service's existing relay backlog gauge.
 *
 * PG-055's gap-prompt assumed no relay-lag signal existed and proposed either a k6 SQL
 * extension or a companion Node script polling the outbox table directly. Neither is
 * needed: event-service already exposes `GET /health/outbox` (unauthenticated,
 * apps/event-service/src/api/health.outbox.routes.ts) returning `queueDepth` — the count
 * of outbox_events rows not yet published — which is exactly the relay-backlog signal
 * this scenario needs. This script polls that route instead of building new plumbing.
 *
 * Read: the queue-depth Trend's `avg`/`max` in the JSON summary. A relay keeping up with
 * this producer rate should keep depth low and roughly flat; a relay falling behind will
 * show depth climbing over the run. The `outbox_queue_depth` threshold below is a rough
 * placeholder (not yet calibrated against a real run) — tighten it once a live run exists.
 *
 * Run: k6 run outbox-relay-throughput.js --out json=load-test-results/outbox-relay.json
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import {
  BASE_AUTH,
  BASE_SALES,
  BASE_EVENT,
  TEST_CREDENTIALS,
  authHeaders,
  buildInvoicePayload,
  assertSafeEnvironment,
  reportSamplesToEventService,
} from './k6-helpers.js';

const queueDepth = new Trend('outbox_queue_depth', false);
const healthOutboxDuration = new Trend('health_outbox_duration', true);
const invoicesProduced = new Counter('outbox_invoices_produced');
const produceErrors = new Counter('outbox_produce_errors');

const PRODUCE_DURATION_S = 120; // sustained invoice creation to keep generating outbox events
const POLL_DURATION_S = 150; // poll a bit past producer stop, to see the backlog drain

export const options = {
  scenarios: {
    producer: {
      executor: 'constant-vus',
      vus: 10,
      duration: `${PRODUCE_DURATION_S}s`,
      exec: 'produce',
    },
    poller: {
      executor: 'constant-vus',
      vus: 1,
      duration: `${POLL_DURATION_S}s`,
      exec: 'poll',
      startTime: '0s',
    },
  },
  thresholds: {
    outbox_produce_errors: ['count==0'],
    // Placeholder — not yet calibrated against a real run (see file header).
    outbox_queue_depth: ['avg<50'],
  },
};

export function setup() {
  assertSafeEnvironment();
  const res = http.post(`${BASE_AUTH}/auth/login`, JSON.stringify(TEST_CREDENTIALS), {
    headers: { 'Content-Type': 'application/json' },
  });
  const token = JSON.parse(res.body ?? '{}')?.data?.accessToken ?? '';
  if (!token) throw new Error('Setup: login failed');
  return { token };
}

export function produce({ token }) {
  const headers = authHeaders(token);
  const res = http.post(`${BASE_SALES}/api/v2/invoices`, buildInvoicePayload(), { headers });
  if (res.status >= 200 && res.status < 300) invoicesProduced.add(1);
  else produceErrors.add(1);
  sleep(0.3); // ~3 req/s per VU x 10 VUs ≈ 30 outbox events/sec while the producer runs
}

export function poll() {
  const start = Date.now();
  const res = http.get(`${BASE_EVENT}/health/outbox`);
  healthOutboxDuration.add(Date.now() - start);

  const body = JSON.parse(res.body ?? '{}');
  queueDepth.add(body?.queueDepth ?? 0);

  sleep(2);
}

export function handleSummary(data) {
  const p95 = data.metrics?.health_outbox_duration?.values?.['p(95)'] ?? 0;
  if (p95 > 0) {
    reportSamplesToEventService([
      { endpoint: '/health/outbox', method: 'GET', durationMs: Math.round(p95) },
    ]);
  }

  const avgDepth = data.metrics?.outbox_queue_depth?.values?.avg ?? null;
  const maxDepth = data.metrics?.outbox_queue_depth?.values?.max ?? null;
  console.log(`Outbox relay backlog during run — avg queueDepth: ${avgDepth}, max: ${maxDepth}`);

  return {
    'load-test-results/outbox-relay-summary.json': JSON.stringify(data, null, 2),
  };
}
