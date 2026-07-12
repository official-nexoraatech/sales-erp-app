// QA session (2026-07-12) -- requireAnyPermission guard tests.
//
// INVENTORY_MANAGER's role-defaults.ts grant included WAREHOUSE_CREATE/WAREHOUSE_UPDATE,
// STOCK_ADJUST, and STOCK_TRANSFER, but every warehouse/adjustment/transfer route actually
// checked only WAREHOUSE_MANAGE -- a constant INVENTORY_MANAGER was never granted. The role
// built specifically to run inventory operations could not create/update a warehouse, or
// create/view/approve a stock adjustment or stock transfer, at all. Fixed with
// requireAnyPermission([granular, WAREHOUSE_MANAGE]) so both keep working.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  warehouses: {},
  inventoryLedger: {},
  stockAdjustments: {},
  stockAdjustmentLines: {},
  stockTransfers: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isNull__'),
  or: vi.fn(() => '__or__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn(() => '__sql__'),
  desc: vi.fn(() => '__desc__'),
}));

import { warehouseRoutes } from '../api/warehouse.routes.js';
import { adjustmentRoutes } from '../api/adjustment.routes.js';
import { transferRoutes } from '../api/transfer.routes.js';

let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: 1,
    email: 'test@erp.local',
    roles: [],
    permissions,
    branchIds: [],
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
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

describe('POST /warehouses -- requireAnyPermission([WAREHOUSE_CREATE, WAREHOUSE_MANAGE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await warehouseRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only WAREHOUSE_CREATE -- INVENTORY_MANAGER is granted this but never had WAREHOUSE_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.WAREHOUSE_CREATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('GET /stock-adjustments -- requireAnyPermission([STOCK_ADJUST, WAREHOUSE_MANAGE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await adjustmentRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/stock-adjustments',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only STOCK_ADJUST', async () => {
    const token = await makeToken([PERMISSIONS.STOCK_ADJUST]);
    const res = await app.inject({
      method: 'GET',
      url: '/stock-adjustments',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('GET /stock-transfers -- requireAnyPermission([STOCK_TRANSFER, WAREHOUSE_MANAGE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await transferRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/stock-transfers',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only STOCK_TRANSFER', async () => {
    const token = await makeToken([PERMISSIONS.STOCK_TRANSFER]);
    const res = await app.inject({
      method: 'GET',
      url: '/stock-transfers',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});
