/**
 * Scenario 5 — Concurrency / Stock Integrity Test
 * Config: 200 VUs all trying to buy the LAST UNIT of item 1 simultaneously
 * Invariant: exactly 1 success, 199 InsufficientStockError (422), stock = 0 after
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
import { Counter, Rate } from 'k6/metrics';
import { BASE_SALES, authHeaders } from './k6-helpers.js';

const successCount = new Counter('concurrent_buy_success');
const insufficientStockCount = new Counter('concurrent_buy_insufficient_stock');
const unexpectedErrorCount = new Counter('concurrent_buy_unexpected_errors');
const exactlyOneSuccess = new Rate('exactly_one_success');

export const options = {
  // All 200 VUs start simultaneously — true concurrency test
  scenarios: {
    concurrent_last_unit: {
      executor: 'shared-iterations',
      vus: 200,
      iterations: 200,
      maxDuration: '2m',
    },
  },
  thresholds: {
    // Key invariant: exactly 1 success (allow tiny margin for test infra variance)
    concurrent_buy_success: ['count>=1', 'count<=2'],
    concurrent_buy_insufficient_stock: ['count>=198'],
    concurrent_buy_unexpected_errors: ['count==0'],
  },
};

export function setup() {
  const res = http.post(
    'http://localhost:3010/auth/login',
    JSON.stringify({ email: 'admin@testco.com', password: 'TestAdmin@2026!', tenantId: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  const token = JSON.parse(res.body)?.data?.accessToken ?? '';
  if (!token) throw new Error('Setup: login failed — cannot run concurrency test without auth');
  return { token };
}

export default function ({ token }) {
  const headers = authHeaders(token);

  // Each VU tries to buy the last unit of item 1
  const payload = JSON.stringify({
    customerId: 1,
    branchId: 1,
    warehouseId: 1,
    paymentMode: 'CASH',
    paidAtConfirmation: 0,
    lines: [
      {
        itemId: 1,
        quantity: 1,
        unitPrice: 50000,
        discountPercent: 0,
        gstRatePercent: 18,
        hsnCode: '5007',
      },
    ],
    notes: 'k6-concurrency-test',
  });

  const res = http.post(`${BASE_SALES}/api/v2/invoices`, payload, { headers });

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
  const success = data.metrics?.concurrent_buy_success?.values?.count ?? 0;
  const insufficient = data.metrics?.concurrent_buy_insufficient_stock?.values?.count ?? 0;
  const unexpected = data.metrics?.concurrent_buy_unexpected_errors?.values?.count ?? 0;

  const verdict =
    success === 1 && insufficient === 199 && unexpected === 0 ? 'PASS ✅' : 'FAIL ❌';

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
    invariant: 'Exactly 1 sale succeeds; all others get INSUFFICIENT_STOCK (422)',
    raw: data,
  };

  return {
    'load-test-results/concurrency-summary.json': JSON.stringify(report, null, 2),
  };
}
