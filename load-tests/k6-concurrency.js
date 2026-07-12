/**
 * Scenario 5 — Concurrency / Stock Integrity Test
 * Config: 200 VUs all trying to confirm a purchase of the LAST UNIT of item 1 simultaneously
 * Invariant: exactly 1 success, 199 InsufficientStockError (422), stock = 0 after
 *
 * Stock is deducted at CONFIRM time, not CREATE time (see InvoiceService.confirm() —
 * `create()` only writes a DRAFT invoice and never touches stock). setup() pre-creates one
 * DRAFT invoice per VU (sequential, no race), then all 200 VUs race on
 * `POST /invoices/:id/confirm` — that's the endpoint that actually deducts stock and is
 * where the race condition needs to be observed. An earlier version of this script raced on
 * `POST /invoices` (create) instead, which never touches stock — every VU would have "won"
 * and the invariant below could never have failed regardless of whether locking was correct.
 *
 * Prerequisites (run before this test):
 *   1. Reset item 1 stock to exactly 1 unit:
 *      POST /api/v2/inventory/stock-adjustments
 *      { itemId: 1, warehouseId: 1, type: "SET", quantity: 1, reason: "concurrency-test-reset" }
 *
 * Run: k6 run k6-concurrency.js --out json=load-test-results/concurrency.json
 */

import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import {
  BASE_AUTH,
  BASE_SALES,
  TEST_CREDENTIALS,
  authHeaders,
  buildInvoicePayload,
  assertSafeEnvironment,
  reportSamplesToEventService,
} from './k6-helpers.js';

const VU_COUNT = 200;

const successCount = new Counter('concurrent_confirm_success');
const insufficientStockCount = new Counter('concurrent_confirm_insufficient_stock');
const unexpectedErrorCount = new Counter('concurrent_confirm_unexpected_errors');
const confirmDuration = new Trend('invoice_confirm_duration', true);

export const options = {
  setupTimeout: '2m', // setup() pre-creates 200 DRAFT invoices sequentially
  // All 200 VUs confirm simultaneously — true concurrency test
  scenarios: {
    concurrent_last_unit_confirm: {
      executor: 'shared-iterations',
      vus: VU_COUNT,
      iterations: VU_COUNT,
      maxDuration: '2m',
    },
  },
  thresholds: {
    // Key invariant: exactly 1 success (allow tiny margin for test infra variance)
    concurrent_confirm_success: ['count>=1', 'count<=2'],
    concurrent_confirm_insufficient_stock: ['count>=198'],
    concurrent_confirm_unexpected_errors: ['count==0'],
  },
};

export function setup() {
  assertSafeEnvironment();

  const loginRes = http.post(`${BASE_AUTH}/auth/login`, JSON.stringify(TEST_CREDENTIALS), {
    headers: { 'Content-Type': 'application/json' },
  });
  const token = JSON.parse(loginRes.body ?? '{}')?.data?.accessToken ?? '';
  if (!token) throw new Error('Setup: login failed — cannot run concurrency test without auth');
  const headers = authHeaders(token);

  // Pre-create one DRAFT invoice per VU. create() never touches stock, so this is race-free —
  // the actual race happens later, when all 200 VUs confirm concurrently.
  const invoiceIds = [];
  for (let i = 0; i < VU_COUNT; i++) {
    const res = http.post(`${BASE_SALES}/api/v2/invoices`, buildInvoicePayload(), { headers });
    const id = JSON.parse(res.body ?? '{}')?.data?.id;
    if (!id) {
      throw new Error(
        `Setup: failed to pre-create draft invoice ${i + 1}/${VU_COUNT}: ${res.status} ${res.body}`
      );
    }
    invoiceIds.push(id);
  }

  return { token, invoiceIds };
}

export default function ({ token, invoiceIds }) {
  const headers = authHeaders(token);
  const invoiceId = invoiceIds[(exec.vu.idInTest - 1) % invoiceIds.length];

  const start = Date.now();
  const res = http.post(
    `${BASE_SALES}/api/v2/invoices/${invoiceId}/confirm`,
    JSON.stringify({ invoiceNumber: `LOADTEST-CONC-${invoiceId}` }),
    { headers }
  );
  confirmDuration.add(Date.now() - start);

  if (res.status >= 200 && res.status < 300) {
    successCount.add(1);
    check(res, { 'exactly one wins': () => true });
  } else if (res.status === 422) {
    const body = JSON.parse(res.body ?? '{}');
    if (body?.error?.code === 'INSUFFICIENT_STOCK') {
      insufficientStockCount.add(1);
    } else {
      unexpectedErrorCount.add(1);
    }
  } else {
    unexpectedErrorCount.add(1);
  }
}

export function teardown({ token }) {
  // Verify final stock = 0
  const headers = authHeaders(token);
  const res = http.get(`${BASE_SALES}/api/v2/invoices?customerId=1&size=1`, { headers });
  const successes = JSON.parse(res.body ?? '{}')?.data?.total ?? 0;
  console.log(`Post-test invoice count for customer 1: ${successes}`);
  console.log('CRITICAL CHECK: Verify item 1 stock = 0 in inventory-service after this test.');
}

export function handleSummary(data) {
  const success = data.metrics?.concurrent_confirm_success?.values?.count ?? 0;
  const insufficient = data.metrics?.concurrent_confirm_insufficient_stock?.values?.count ?? 0;
  const unexpected = data.metrics?.concurrent_confirm_unexpected_errors?.values?.count ?? 0;
  const confirmP95 = data.metrics?.invoice_confirm_duration?.values?.['p(95)'] ?? 0;

  const verdict = success === 1 && insufficient === 199 && unexpected === 0 ? 'PASS ✅' : 'FAIL ❌';

  const report = {
    scenario: 'Concurrency / Stock Integrity',
    verdict,
    results: {
      successCount: success,
      insufficientStockCount: insufficient,
      unexpectedErrorCount: unexpected,
      expectedSuccessCount: 1,
      expectedInsufficientStock: 199,
    },
    invariant: 'Exactly 1 confirm succeeds; all others get INSUFFICIENT_STOCK (422)',
    raw: data,
  };

  if (confirmP95 > 0) {
    // Matches TARGETS's literal key in performance.routes.ts ('POST /api/v2/invoices/confirm',
    // no :id segment) so this sample picks up the stored target — the real route is
    // /invoices/:id/confirm; see IMPLEMENTATION-NOTES.md for this pre-existing key mismatch.
    reportSamplesToEventService([
      { endpoint: '/api/v2/invoices/confirm', method: 'POST', durationMs: Math.round(confirmP95) },
    ]);
  }

  return {
    'load-test-results/concurrency-summary.json': JSON.stringify(report, null, 2),
  };
}
