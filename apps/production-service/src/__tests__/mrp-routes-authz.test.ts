// Manufacturing vertical — mrp.routes.ts authorization + wiring tests, mirroring
// routing-routes-authz.test.ts's own mocked-db pattern. Focuses on the 401/403 boundary for each
// route plus one 200/201 success check proving the tenantScopedHandler wiring works — the domain
// logic (MRPService itself) is already thoroughly covered by mrp-service.test.ts against a real
// database.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id' },
  boms: {
    __name: 'boms',
    id: 'id',
    tenantId: 'tenant_id',
    finishedItemId: 'finished_item_id',
    isActive: 'is_active',
  },
  bomLines: { __name: 'bom_lines', bomId: 'bom_id' },
  productionOrders: {
    __name: 'production_orders',
    tenantId: 'tenant_id',
    outputItemId: 'output_item_id',
    status: 'status',
  },
  purchaseOrders: { __name: 'purchase_orders', id: 'id', status: 'status' },
  purchaseOrderLines: {
    __name: 'purchase_order_lines',
    tenantId: 'tenant_id',
    itemId: 'item_id',
    purchaseOrderId: 'purchase_order_id',
  },
  projectionStockLevel: {
    __name: 'projection_stock_level',
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
  },
  purchaseRequisitions: { __name: 'purchase_requisitions', id: 'id' },
  purchaseRequisitionLines: {
    __name: 'purchase_requisition_lines',
    requisitionId: 'requisition_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ __inArray__: [a, b] })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { mrpRoutes } from '../api/mrp.routes.js';

let privateKey: KeyLike;

beforeAll(async () => {
  const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(priv, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pub;
});

async function signToken(opts: {
  sub: string;
  tenantId: number;
  permissions: string[];
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: opts.tenantId,
    email: 'test@example.com',
    roles: [],
    permissions: opts.permissions,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(opts.sub)
    .setIssuedAt(nowSec)
    .setIssuer('erp-auth-service')
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

function chain(result: unknown): unknown {
  return Object.assign(Promise.resolve(result), {
    from: (_t?: unknown) => chain(result),
    where: (_c?: unknown) => chain(result),
    innerJoin: (_t?: unknown, _c?: unknown) => chain(result),
    orderBy: (_c?: unknown) => chain(result),
  });
}

function makeFakeDb(testItem: {
  id: number;
  name: string;
  itemCode: string;
  availableQty: string;
}): Record<string, unknown> {
  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: { __name: string }) => {
        if (table.__name === 'items') return chain([testItem]);
        return chain([]);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: () =>
        Object.assign(Promise.resolve([]), {
          returning: async () => (table.__name === 'purchase_requisitions' ? [{ id: 42 }] : []),
        }),
    }),
    execute: async () => [],
    transaction: async (cb: (trx: Record<string, unknown>) => Promise<unknown>) => cb(db),
  };
  return db;
}

async function buildApp(testItem: {
  id: number;
  name: string;
  itemCode: string;
  availableQty: string;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const db = makeFakeDb(testItem);
  const ctxFactory = {
    rawDb: db,
    create: (tenant: { tenantId: number; userId: number }, dbOverride?: unknown) => ({
      tenant,
      db: { raw: dbOverride ?? db },
    }),
  } as unknown as PlatformContextFactory;
  await mrpRoutes(app, ctxFactory);
  return app;
}

const defaultItem = { id: 1, name: 'Test Item', itemCode: 'TI1', availableQty: '10' };

const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['MRP_VIEW'] });
const requisitionerToken = () =>
  signToken({ sub: '1', tenantId: 1, permissions: ['MRP_CREATE_REQUISITION'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['ROUTING_VIEW'] });

describe('mrp.routes.ts authorization', () => {
  it('POST /mrp/run — 401 with no token', async () => {
    const app = await buildApp(defaultItem);
    const res = await app.inject({
      method: 'POST',
      url: '/mrp/run',
      payload: { demandLines: [{ itemId: 1, requiredQty: 50 }] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /mrp/run — 403 without MRP_VIEW', async () => {
    const app = await buildApp(defaultItem);
    const res = await app.inject({
      method: 'POST',
      url: '/mrp/run',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: { demandLines: [{ itemId: 1, requiredQty: 50 }] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /mrp/run — 200 for a real caller, nets demand against on-hand stock (no BOM/open orders)', async () => {
    const app = await buildApp(defaultItem);
    const res = await app.inject({
      method: 'POST',
      url: '/mrp/run',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
      payload: { demandLines: [{ itemId: 1, requiredQty: 50 }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { toProduce: unknown[]; toPurchase: Array<{ itemId: number; netQty: number }> };
    };
    expect(body.data.toProduce).toHaveLength(0);
    expect(body.data.toPurchase).toEqual([expect.objectContaining({ itemId: 1, netQty: 40 })]);
    await app.close();
  });

  it('POST /mrp/requisitions — 401 with no token', async () => {
    const app = await buildApp(defaultItem);
    const res = await app.inject({
      method: 'POST',
      url: '/mrp/requisitions',
      payload: { branchId: 1, lines: [{ itemId: 1, qty: 10 }] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /mrp/requisitions — 403 without MRP_CREATE_REQUISITION', async () => {
    const app = await buildApp(defaultItem);
    const res = await app.inject({
      method: 'POST',
      url: '/mrp/requisitions',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: { branchId: 1, lines: [{ itemId: 1, qty: 10 }] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /mrp/requisitions — 201 for a real caller with MRP_CREATE_REQUISITION', async () => {
    const app = await buildApp(defaultItem);
    const res = await app.inject({
      method: 'POST',
      url: '/mrp/requisitions',
      headers: { Authorization: `Bearer ${await requisitionerToken()}` },
      payload: { branchId: 1, lines: [{ itemId: 1, qty: 10 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ data: { id: 42 } });
    await app.close();
  });
});
