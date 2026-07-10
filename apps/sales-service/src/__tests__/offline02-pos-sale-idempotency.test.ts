/**
 * OFFLINE-02 — POST /pos/sales returns the original result on a retried offline-sale sync
 * instead of creating a duplicate invoice. InvoiceService is mocked here (its own dedup
 * translation is covered by offline02-idempotency.test.ts) so these tests isolate the
 * route-level behavior: short-circuiting before confirm()/payment/loyalty on a duplicate,
 * polling for an in-flight winner, and giving up cleanly if it never resolves.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type * as InvoiceServiceModule from '../domain/InvoiceService.js';

vi.mock('@erp/db', () => ({
  posSessions: { id: 'id', tenantId: 'tenant_id', status: 'status', totalSales: 'total_sales', totalTransactions: 'total_transactions' },
  posHeldSales: {}, invoices: { id: 'id', tenantId: 'tenant_id', clientOperationId: 'client_operation_id', status: 'status', invoiceNumber: 'invoice_number', grandTotal: 'grand_total', loyaltyPointsEarned: 'loyalty_points_earned', loyaltyRedemptionValue: 'loyalty_redemption_value' },
  invoiceLines: {}, items: {},
  customers: {}, projectionDashboardDaily: {}, organizationSettings: {},
  payments: {}, paymentAllocations: { paymentId: 'payment_id', invoiceId: 'invoice_id', tenantId: 'tenant_id' },
  projectionCustomerBalance: {}, outboxEvents: {},
  loyaltyTransactions: {}, featureFlags: {}, invoiceHistory: {}, quotations: {},
  deliveryChallans: {}, inventoryLedger: {}, inventoryFifoLayers: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  desc: vi.fn(() => '__desc__'),
  asc: vi.fn(() => '__asc__'),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn((s) => s),
  inArray: vi.fn(() => '__inArray__'),
  lt: vi.fn(() => '__lt__'),
}));

vi.mock('../domain/InvoiceService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof InvoiceServiceModule>();
  return { ...actual, InvoiceService: vi.fn() };
});

import { posRoutes } from '../api/pos.routes.js';
import { InvoiceService, DuplicateOperationError } from '../domain/InvoiceService.js';

const TEST_ISSUER = 'erp-test';
const TEST_TTL = 900;
let privateKey: KeyLike;

async function makeToken(permissions: string[], branchIds: number[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'cashier@erp.local', roles: [], permissions, branchIds })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer(TEST_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TEST_TTL)
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

afterEach(() => {
  vi.clearAllMocks();
});

const SALE_BODY = {
  sessionId: 1,
  branchId: 2,
  warehouseId: 1,
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  lines: [{ itemId: 1, quantity: 1, unitPrice: 100, gstRate: 18 }],
  paymentMode: 'CASH',
  amountTendered: 118,
  operationId: '11111111-1111-4111-8111-111111111111',
};

// Sequential-response chainable query builder — resolves each `select`/`selectDistinct`
// call to the next queued value, in call order (mirrors the shared harness used by
// InvoiceService's own tests, adapted for a plain (non-transaction) db handle).
function makeChainableDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'selectDistinct', 'from', 'where', 'orderBy', 'limit', 'insert', 'values', 'update', 'set']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

function makeCtxFactory(script: unknown[]) {
  return {
    create: () => ({
      db: { raw: makeChainableDb(script), transaction: vi.fn() },
      cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
      events: { publish: vi.fn() },
      audit: { log: vi.fn() },
    }),
  } as never;
}

const OPEN_SESSION = { id: 1, tenantId: 1, status: 'OPEN' };

describe('POST /pos/sales — OFFLINE-02 idempotent retry handling', () => {
  let app: FastifyInstance;

  afterEach(() => app?.close());

  it('returns the already-committed original result on a retried operationId, without calling confirm()', async () => {
    const confirmSpy = vi.fn();
    (InvoiceService as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() => ({
      create: vi.fn().mockRejectedValue(new DuplicateOperationError(SALE_BODY.operationId)),
      confirm: confirmSpy,
    }));

    const script = [
      [OPEN_SESSION], // session lookup
      [{ id: 42, invoiceNumber: 'POS-1-100', status: 'CONFIRMED', grandTotal: '118.00', loyaltyPointsEarned: 0, loyaltyRedemptionValue: '0.00' }], // waitForOperationResult poll #1 — already confirmed
      [{ paymentId: 77 }], // payment allocations lookup
    ];

    app = Fastify({ logger: false });
    await posRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: SALE_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { invoiceId: number; invoiceNumber: string; paymentIds: number[] } };
    expect(body.data.invoiceId).toBe(42);
    expect(body.data.invoiceNumber).toBe('POS-1-100');
    expect(body.data.paymentIds).toEqual([77]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('polls until the in-flight winner commits, then returns its result', async () => {
    (InvoiceService as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() => ({
      create: vi.fn().mockRejectedValue(new DuplicateOperationError(SALE_BODY.operationId)),
      confirm: vi.fn(),
    }));

    const script = [
      [OPEN_SESSION], // session lookup
      [{ id: 42, invoiceNumber: null, status: 'DRAFT', grandTotal: '0', loyaltyPointsEarned: 0, loyaltyRedemptionValue: '0.00' }], // poll #1 — winner still mid-flight
      [{ id: 42, invoiceNumber: 'POS-1-100', status: 'CONFIRMED', grandTotal: '118.00', loyaltyPointsEarned: 0, loyaltyRedemptionValue: '0.00' }], // poll #2 — winner committed
      [{ paymentId: 77 }],
    ];

    app = Fastify({ logger: false });
    await posRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: SALE_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { invoiceId: number } };
    expect(body.data.invoiceId).toBe(42);
  }, 10_000);

  it('returns 409 if the in-flight winner never resolves within the polling window', async () => {
    (InvoiceService as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() => ({
      create: vi.fn().mockRejectedValue(new DuplicateOperationError(SALE_BODY.operationId)),
      confirm: vi.fn(),
    }));

    // Every poll attempt (10) sees the invoice still stuck in DRAFT.
    const draftRow = [{ id: 42, invoiceNumber: null, status: 'DRAFT', grandTotal: '0', loyaltyPointsEarned: 0, loyaltyRedemptionValue: '0.00' }];
    const script = [[OPEN_SESSION], ...Array(10).fill(draftRow)];

    app = Fastify({ logger: false });
    await posRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: SALE_BODY,
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('DUPLICATE_OPERATION_PROCESSING');
  }, 10_000);
});
