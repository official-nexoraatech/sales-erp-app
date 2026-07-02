/**
 * Shared helpers for all k6 load test scripts.
 * Auth-service: http://localhost:3010
 * Sales-service: http://localhost:3013
 * Inventory-service: http://localhost:3012
 */

import http from 'k6/http';
import { check } from 'k6';

export const BASE_AUTH = 'http://localhost:3010';
export const BASE_SALES = 'http://localhost:3013';
export const BASE_INVENTORY = 'http://localhost:3012';

export const TEST_CREDENTIALS = {
  email: 'admin@testco.com',
  password: 'TestAdmin@2026!',
  tenantId: 1,
};

/** Login and return an access token. Call once per VU in setup(). */
export function login() {
  const res = http.post(
    `${BASE_AUTH}/auth/login`,
    JSON.stringify(TEST_CREDENTIALS),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  return JSON.parse(res.body).data?.accessToken ?? '';
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
