/**
 * Shared helpers for all k6 load test scripts.
 * Auth-service: http://localhost:3010
 * Sales-service: http://localhost:3013
 * Inventory-service: http://localhost:3012
 */

import http from 'k6/http';
import { check } from 'k6';

export const BASE_AUTH = __ENV.BASE_AUTH_URL || 'http://localhost:3010';
export const BASE_SALES = __ENV.BASE_SALES_URL || 'http://localhost:3013';
export const BASE_INVENTORY = __ENV.BASE_INVENTORY_URL || 'http://localhost:3012';
export const BASE_EVENT = __ENV.BASE_EVENT_URL || 'http://localhost:3023';

export const TEST_CREDENTIALS = {
  email: 'admin@testco.com',
  password: 'TestAdmin@2026!',
  tenantId: 1,
};

// Refuses to run against anything that looks like a real environment. Every scenario's
// setup() must call this before generating any load — see PG-055 gap-prompt's Security section.
// The company domain (nexoraatech.com, per ci.yml's deploy-staging job) is blocked unless the
// host also names "staging" explicitly — erp-staging.nexoraatech.com is a legitimate,
// intentional LOAD_TEST_ENV=staging target; erp.nexoraatech.com or any other subdomain is not.
const PRODUCTION_HOST_PATTERNS = [
  /\bnexoraatech\.(com|io|tech)\b/i,
  /\.erp\.com$/i,
  /\bprod(uction)?\b/i,
];
const SAFE_HOST_HINTS = [/localhost/i, /127\.0\.0\.1/i, /\bstaging\b/i];

export function assertSafeEnvironment() {
  const env = __ENV.LOAD_TEST_ENV || 'local';
  if (env !== 'local' && env !== 'staging') {
    throw new Error(
      `LOAD_TEST_ENV must be 'local' or 'staging' (got '${env}') — refusing to run. ` +
        `Pass -e LOAD_TEST_ENV=local (or staging) explicitly.`
    );
  }
  for (const url of [BASE_AUTH, BASE_SALES, BASE_INVENTORY, BASE_EVENT]) {
    const looksProd = PRODUCTION_HOST_PATTERNS.some((p) => p.test(url));
    const looksSafe = SAFE_HOST_HINTS.some((p) => p.test(url));
    if (looksProd && !looksSafe) {
      throw new Error(`Refusing to run load test — target URL looks like production: ${url}`);
    }
  }
}

/** Login and return an access token. Call once per VU in setup(). */
export function login() {
  const res = http.post(`${BASE_AUTH}/auth/login`, JSON.stringify(TEST_CREDENTIALS), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
  return JSON.parse(res.body).data?.accessToken ?? '';
}

/**
 * POST measured percentiles back to event-service's existing samples sink
 * (`POST /admin/performance/samples`) so `GET /admin/performance/baselines` shows real data.
 * Re-authenticates independently since handleSummary() doesn't share VU/setup() state.
 * samples: Array<{ endpoint: string, method: string, durationMs: number }>
 */
export function reportSamplesToEventService(samples) {
  if (!samples || samples.length === 0) return;

  const loginRes = http.post(`${BASE_AUTH}/auth/login`, JSON.stringify(TEST_CREDENTIALS), {
    headers: { 'Content-Type': 'application/json' },
  });
  const token = JSON.parse(loginRes.body ?? '{}')?.data?.accessToken;
  if (!token) {
    console.error('reportSamplesToEventService: login failed, skipping sample POST');
    return;
  }

  const headers = authHeaders(token);
  for (const sample of samples) {
    const res = http.post(`${BASE_EVENT}/admin/performance/samples`, JSON.stringify(sample), {
      headers,
    });
    if (res.status !== 201) {
      console.error(
        `reportSamplesToEventService: failed to record ${sample.method} ${sample.endpoint}: ${res.status} ${res.body}`
      );
    }
  }
}

/** Return headers object with Authorization Bearer token. */
export function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/** Minimal invoice payload for sales-service. */
export function buildInvoicePayload() {
  return JSON.stringify({
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
    notes: 'k6 load test',
  });
}
