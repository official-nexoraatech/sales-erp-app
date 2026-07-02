/**
 * Scenario 3 — Spike Test
 * Config: 10→500 VUs in 2 minutes, hold 2 min, drop back
 * Verify: HPA fires and scales correctly within 90 seconds
 * Watch: kubectl get hpa -n erp-system -w during this test
 *
 * Run: k6 run k6-spike.js --out json=load-test-results/spike.json
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_SALES, authHeaders, buildInvoicePayload } from './k6-helpers.js';

const spikeErrors = new Rate('spike_errors');
const spikeDuration = new Trend('spike_duration', true);

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // baseline
    { duration: '2m', target: 500 },  // spike — instant surge
    { duration: '2m', target: 500 },  // hold at spike — HPA should fire within 90s
    { duration: '2m', target: 10 },   // recovery
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    // During spike: allow degraded P95, but no 5xx cascade
    spike_errors: ['rate<0.05'],
    // P95 may be higher during spike; key metric is no total failure
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  const res = http.post(
    'http://localhost:3010/auth/login',
    JSON.stringify({ email: 'admin@testco.com', password: 'TestAdmin@2026!', tenantId: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  return { token: JSON.parse(res.body)?.data?.accessToken ?? '' };
}

export default function ({ token }) {
  const headers = authHeaders(token);
  const start = Date.now();

  const rand = Math.random();
  let res;

  if (rand < 0.7) {
    res = http.get(`${BASE_SALES}/api/v2/invoices?page=1&size=20`, { headers });
  } else {
    res = http.post(`${BASE_SALES}/api/v2/invoices`, buildInvoicePayload(), { headers });
  }

  spikeDuration.add(Date.now() - start);
  spikeErrors.add(res.status >= 500 ? 1 : 0);
  check(res, { 'not 5xx': (r) => r.status < 500 });

  sleep(0.1); // Minimal sleep — we want to generate the spike
}

export function handleSummary(data) {
  return {
    'load-test-results/spike-summary.json': JSON.stringify(data, null, 2),
  };
}
