/**
 * Scenario 1 — Normal Load (baseline)
 * Config: 50 VUs, 30 minutes, ramping (0→50 in 2 min, hold 26 min, 50→0 in 2 min)
 * Mix: 60% read (GET /invoices, GET /stock), 30% invoice create, 10% reports
 * Targets: P95 < 500ms, P99 < 1000ms, error rate < 0.1%
 *
 * Run: k6 run k6-normal-load.js --out json=load-test-results/normal-load.json
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_SALES, BASE_INVENTORY, authHeaders, buildInvoicePayload } from './k6-helpers.js';

// Custom metrics
const invoiceCreateDuration = new Trend('invoice_create_duration', true);
const listInvoicesDuration = new Trend('list_invoices_duration', true);
const stockQueryDuration = new Trend('stock_query_duration', true);
const errorRate = new Rate('errors');
const invoicesCreated = new Counter('invoices_created');

export const options = {
  stages: [
    { duration: '2m', target: 50 },  // ramp up
    { duration: '26m', target: 50 }, // hold
    { duration: '2m', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.001'],
    invoice_create_duration: ['p(95)<500'],
    list_invoices_duration: ['p(95)<300'],
    stock_query_duration: ['p(95)<200'],
  },
};

export function setup() {
  // Login once and pass token to VUs
  const res = http.post(
    `http://localhost:3010/auth/login`,
    JSON.stringify({ email: 'admin@testco.com', password: 'TestAdmin@2026!', tenantId: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  const token = JSON.parse(res.body)?.data?.accessToken ?? '';
  return { token };
}

export default function ({ token }) {
  const headers = authHeaders(token);
  const rand = Math.random();

  if (rand < 0.6) {
    // 60% reads — alternate between invoices list and stock query
    if (rand < 0.3) {
      const start = Date.now();
      const res = http.get(`${BASE_SALES}/api/v2/invoices?page=1&size=20`, { headers });
      listInvoicesDuration.add(Date.now() - start);
      const ok = check(res, { 'list invoices 200': (r) => r.status === 200 });
      if (!ok) errorRate.add(1);
      else errorRate.add(0);
    } else {
      const start = Date.now();
      const res = http.get(`${BASE_INVENTORY}/api/v2/warehouses/1/stock?page=1&size=20`, { headers });
      stockQueryDuration.add(Date.now() - start);
      const ok = check(res, { 'stock query 200': (r) => r.status === 200 });
      if (!ok) errorRate.add(1);
      else errorRate.add(0);
    }
  } else if (rand < 0.9) {
    // 30% invoice creates
    const start = Date.now();
    const res = http.post(
      `${BASE_SALES}/api/v2/invoices`,
      buildInvoicePayload(),
      { headers }
    );
    invoiceCreateDuration.add(Date.now() - start);
    const ok = check(res, { 'invoice create 2xx': (r) => r.status >= 200 && r.status < 300 });
    if (ok) invoicesCreated.add(1);
    errorRate.add(ok ? 0 : 1);
  } else {
    // 10% reports — list customers (heavy join)
    const res = http.get(`${BASE_SALES}/api/v2/customers?page=1&size=50`, { headers });
    const ok = check(res, { 'customers list 200': (r) => r.status === 200 });
    errorRate.add(ok ? 0 : 1);
  }

  sleep(1); // ~1 RPS per VU → 50 RPS total
}

export function handleSummary(data) {
  return {
    'load-test-results/normal-load-summary.json': JSON.stringify(data, null, 2),
  };
}
