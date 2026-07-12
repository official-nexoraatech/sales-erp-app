/**
 * Scenario 2 — Peak Load (Diwali simulation)
 * Config: 200 VUs, 2 hours
 * Mix: Same as normal load but sustained under high concurrency
 * Targets: P95 < 2000ms, error rate < 1%
 *
 * Run: k6 run k6-peak-load.js --out json=load-test-results/peak-load.json
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import {
  BASE_AUTH,
  BASE_SALES,
  BASE_INVENTORY,
  TEST_CREDENTIALS,
  authHeaders,
  buildInvoicePayload,
  assertSafeEnvironment,
  reportSamplesToEventService,
} from './k6-helpers.js';

const invoiceCreateDuration = new Trend('peak_invoice_create_duration', true);
const errorRate = new Rate('peak_errors');

export const options = {
  stages: [
    { duration: '5m', target: 200 }, // ramp up to peak
    { duration: '110m', target: 200 }, // hold at peak (Diwali rush)
    { duration: '5m', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    peak_errors: ['rate<0.01'],
    peak_invoice_create_duration: ['p(95)<2000'],
  },
};

export function setup() {
  assertSafeEnvironment();
  const res = http.post(`${BASE_AUTH}/auth/login`, JSON.stringify(TEST_CREDENTIALS), {
    headers: { 'Content-Type': 'application/json' },
  });
  return { token: JSON.parse(res.body)?.data?.accessToken ?? '' };
}

export default function ({ token }) {
  const headers = authHeaders(token);
  const rand = Math.random();

  if (rand < 0.5) {
    const res = http.get(`${BASE_SALES}/api/v2/invoices?page=1&size=20`, { headers });
    errorRate.add(res.status !== 200 ? 1 : 0);
  } else if (rand < 0.8) {
    const start = Date.now();
    const res = http.post(`${BASE_SALES}/api/v2/invoices`, buildInvoicePayload(), { headers });
    invoiceCreateDuration.add(Date.now() - start);
    errorRate.add(res.status >= 400 ? 1 : 0);
  } else {
    const res = http.get(`${BASE_INVENTORY}/api/v2/warehouses/1/stock?page=1&size=20`, { headers });
    errorRate.add(res.status !== 200 ? 1 : 0);
  }

  sleep(0.5); // Higher RPS under peak conditions
}

export function handleSummary(data) {
  const p95 = data.metrics?.peak_invoice_create_duration?.values?.['p(95)'] ?? 0;
  if (p95 > 0) {
    reportSamplesToEventService([
      { endpoint: '/api/v2/invoices', method: 'POST', durationMs: Math.round(p95) },
    ]);
  }

  return {
    'load-test-results/peak-load-summary.json': JSON.stringify(data, null, 2),
  };
}
