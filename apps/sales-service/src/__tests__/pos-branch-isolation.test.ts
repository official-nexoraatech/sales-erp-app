/**
 * OFFLINE-01 — Branch-isolation guard on pos.routes.ts
 * POST /pos/sessions/open and POST /pos/sales must reject a client-submitted branchId
 * that isn't one of the caller's JWT-scoped branchIds, instead of trusting it blindly.
 * No live DB needed: the check runs before any DB access, so @erp/db is mocked the same
 * way apps/sales-service/src/__tests__/permission-guards.test.ts mocks it for invoice.routes.ts.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  posSessions: {},
  posHeldSales: {},
  invoices: {},
  invoiceLines: {},
  items: {},
  customers: {},
  projectionDashboardDaily: {},
  organizationSettings: {},
  payments: {},
  paymentAllocations: {},
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
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  asc: vi.fn(() => '__asc__'),
  eq: vi.fn(() => '__eq__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn(() => '__sql__'),
  inArray: vi.fn(() => '__inArray__'),
  lt: vi.fn(() => '__lt__'),
}));

import { posRoutes } from '../api/pos.routes.js';

const TEST_ISSUER = 'erp-test';
const TEST_TTL = 900;

let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

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

const VALID_SALE_BODY = {
  sessionId: 1,
  branchId: 2,
  warehouseId: 1,
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  lines: [{ itemId: 1, quantity: 1, unitPrice: 100, gstRate: 18 }],
  paymentMode: 'CASH',
  amountTendered: 118,
};

describe('Branch isolation guard on POST /pos/sales', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await posRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it("rejects a branchId not in the caller's JWT branchIds with 403", async () => {
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [1, 3]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_SALE_BODY,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  it("does not reject a branchId that is in the caller's JWT branchIds", async () => {
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2, 3]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_SALE_BODY,
    });

    // Not blocked by the branch guard — the mocked DB means it can't fully succeed,
    // but it must get past the 403 check (matches the convention in permission-guards.test.ts).
    expect(res.statusCode).not.toBe(403);
  });

  it('does not reject any branchId when the caller has no branch assignments (getBranchScope => all)', async () => {
    const token = await makeToken([PERMISSIONS.POS_MANAGE], []);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_SALE_BODY,
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('does not reject any branchId when the caller holds BRANCH_SCOPE_BYPASS', async () => {
    const token = await makeToken([PERMISSIONS.POS_MANAGE, 'BRANCH_SCOPE_BYPASS'], [9]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sales',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_SALE_BODY, branchId: 999 },
    });

    expect(res.statusCode).not.toBe(403);
  });
});

describe('Branch isolation guard on POST /pos/sessions/open', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await posRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it("rejects a branchId not in the caller's JWT branchIds with 403", async () => {
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [1]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sessions/open',
      headers: { Authorization: `Bearer ${token}` },
      payload: { branchId: 2, warehouseId: 1, openingCash: 0 },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  it("does not reject a branchId that is in the caller's JWT branchIds", async () => {
    const token = await makeToken([PERMISSIONS.POS_MANAGE], [2]);

    const res = await app.inject({
      method: 'POST',
      url: '/pos/sessions/open',
      headers: { Authorization: `Bearer ${token}` },
      payload: { branchId: 2, warehouseId: 1, openingCash: 0 },
    });

    expect(res.statusCode).not.toBe(403);
  });
});
