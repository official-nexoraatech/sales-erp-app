/**
 * Scenario 4 — Soak Test (24-hour endurance)
 * Config: 100 VUs, 24 hours
 * Monitor: memory growth per pod — should be flat (no memory leaks)
 * Alert threshold: if pod memory grows > 20% over 24h → leak suspected
 *
 * Run: k6 run k6-soak.js --out json=load-test-results/soak.json
 *
 * Pair with: kubectl top pods -n erp-system --containers -w >> soak-memory.log
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Gauge } from 'k6/metrics';
import {
  BASE_AUTH,
  BASE_SALES,
  BASE_INVENTORY,
  TEST_CREDENTIALS,
  authHeaders,
  buildInvoicePayload,
  assertSafeEnvironment,
} from './k6-helpers.js';

const soakErrors = new Rate('soak_errors');
const soakLatency = new Trend('soak_latency', true);

export const options = {
  stages: [
    { duration: '5m', target: 100 }, // ramp up
    { duration: '23h50m', target: 100 }, // 24-hour hold
    { duration: '5m', target: 0 }, // ramp down
  ],
  thresholds: {
    // Sustained healthy performance over 24 hours
    soak_errors: ['rate<0.005'],
    soak_latency: ['p(95)<800'], // slightly relaxed for long-running soak
    http_req_failed: ['rate<0.005'],
  },
};

export function setup() {
  assertSafeEnvironment();
  const res = http.post(`${BASE_AUTH}/auth/login`, JSON.stringify(TEST_CREDENTIALS), {
    headers: { 'Content-Type': 'application/json' },
  });
  return { token: JSON.parse(res.body)?.data?.accessToken ?? '', startTime: Date.now() };
}

export default function ({ token }) {
  const headers = authHeaders(token);
  const rand = Math.random();
  const start = Date.now();
  let res;

  if (rand < 0.5) {
    res = http.get(`${BASE_SALES}/api/v2/invoices?page=1&size=20`, { headers });
  } else if (rand < 0.75) {
    res = http.post(`${BASE_SALES}/api/v2/invoices`, buildInvoicePayload(), { headers });
  } else if (rand < 0.9) {
    res = http.get(`${BASE_INVENTORY}/api/v2/warehouses/1/stock?page=1&size=20`, { headers });
  } else {
    // Every 10th VU iteration: also test /customers for JOIN-heavy query
    res = http.get(`${BASE_SALES}/api/v2/customers?page=1&size=50`, { headers });
  }

  soakLatency.add(Date.now() - start);
  soakErrors.add(res.status >= 400 ? 1 : 0);
  check(res, { 'soak not 5xx': (r) => r.status < 500 });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'load-test-results/soak-summary.json': JSON.stringify(data, null, 2),
  };
}
