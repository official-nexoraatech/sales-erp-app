/**
 * OFFLINE-07 — POST /pos/sales distinguishes a stock-conflict confirm() failure from
 * other errors with a machine-readable INSUFFICIENT_STOCK code + { itemId, available,
 * requested } details, and voids the orphaned DRAFT invoice create() already committed
 * (confirm() runs in its own transaction, separate from create()'s) so a later
 * adjust-and-retry (new operationId) isn't blocked by a dead, un-confirmable record.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type * as InvoiceServiceModule from '../domain/InvoiceService.js';

vi.mock('@erp/db', () => ({
  posSessions: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    totalSales: 'total_sales',
    totalTransactions: 'total_transactions',
  },
  posHeldSales: {},
  invoices: {
    id: 'id',
    tenantId: 'tenant_id',
    clientOperationId: 'client_operation_id',
    status: 'status',
    invoiceNumber: 'invoice_number',
    grandTotal: 'grand_total',
    loyaltyPointsEarned: 'loyalty_points_earned',
    loyaltyRedemptionValue: 'loyalty_redemption_value',
  },
  invoiceLines: {},
  items: {},
  customers: {},
  projectionDashboardDaily: {},
  organizationSettings: {},
  payments: {},
  paymentAllocations: { paymentId: 'payment_id', invoiceId: 'invoice_id', tenantId: 'tenant_id' },
  projectionCustomerBalance: {},
  outboxEvents: {},
  loyaltyTransactions: {},
  featureFlags: {},
  invoiceHistory: {},
  quotations: {},
  deliveryChallans: {},
  inventoryLedger: {},
  inventoryFifoLayers: {},
  webhookSubscriptions: {},
  webhookDeliveries: {},
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
import { InvoiceService, InsufficientStockError } from '../domain/InvoiceService.js';

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
  lines: [{ itemId: 7, quantity: 5, unitPrice: 100, gstRate: 18 }],
  paymentMode: 'CASH',
  amountTendered: 590,
  operationId: '22222222-2222-4222-8222-222222222222',
};

function makeChainableDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'selectDistinct',
    'from',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'update',
    'set',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
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

describe('POST /pos/sales — OFFLINE-07 stock-conflict handling', () => {
  let app: FastifyInstance;

  afterEach(() => app?.close());

  it('returns a distinguishable INSUFFICIENT_STOCK error with available/requested details, and cancels the orphaned DRAFT invoice', async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    (
      InvoiceService as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(() => ({
      create: vi.fn().mockResolvedValue(42),
      confirm: vi.fn().mockRejectedValue(new InsufficientStockError(7, 2, 5)),
      cancel: cancelSpy,
    }));

    const script = [[OPEN_SESSION]];

    app = Fastify({ logger: false });
    await posRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: SALE_BODY,
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as {
      error: { code: string; details: { itemId: number; available: number; requested: number } };
    };
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(body.error.details).toEqual({ itemId: 7, available: 2, requested: 5 });

    expect(cancelSpy).toHaveBeenCalledWith(42, 1, 1, expect.stringContaining('Stock conflict'));
  });

  it('propagates a non-stock error from confirm() unchanged (no cancel, no STOCK_CONFLICT translation)', async () => {
    const cancelSpy = vi.fn();
    (
      InvoiceService as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(() => ({
      create: vi.fn().mockResolvedValue(42),
      confirm: vi.fn().mockRejectedValue(new Error('boom')),
      cancel: cancelSpy,
    }));

    const script = [[OPEN_SESSION]];

    app = Fastify({ logger: false });
    await posRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: SALE_BODY,
    });

    expect(res.statusCode).toBe(500);
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});
