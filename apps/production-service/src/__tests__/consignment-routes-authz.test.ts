// Phase 9 GUC-per-request rollout — consignment.routes.ts authorization + wiring tests, migrated
// to tenantScopedHandler 2026-08-21. Same shape as the other *-routes-authz.test.ts files: 401/403
// boundary for every route plus one 200 success-path check. ConsignmentService's own domain logic
// (recordSale concurrency, receive/return/settle math) is covered by consignment-concurrency.
// integration.test.ts against a real database.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  consignmentStocks: {
    __name: 'consignment_stocks',
    id: 'id',
    tenantId: 'tenant_id',
    supplierId: 'supplier_id',
  },
  consignmentSettlements: {
    __name: 'consignment_settlements',
    id: 'id',
    tenantId: 'tenant_id',
    supplierId: 'supplier_id',
  },
  suppliers: { __name: 'suppliers', id: 'id', tenantId: 'tenant_id', displayName: 'display_name' },
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id', name: 'name' },
  warehouses: { __name: 'warehouses', id: 'id', tenantId: 'tenant_id', name: 'name' },
  outboxEvents: { __name: 'outbox_events' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  desc: vi.fn((a: unknown) => ({ __desc__: a })),
  getTableColumns: vi.fn(() => ({})),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

import { consignmentRoutes } from '../api/consignment.routes.js';

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
    leftJoin: (_t?: unknown, _c?: unknown) => chain(result),
    orderBy: (..._c: unknown[]) => chain(result),
  });
}

function makeFakeDb(): Record<string, unknown> {
  const db: Record<string, unknown> = {
    select: () => chain([]),
    execute: async () => [],
    transaction: async (cb: (trx: Record<string, unknown>) => Promise<unknown>) => cb(db),
  };
  return db;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const db = makeFakeDb();
  const ctxFactory = {
    rawDb: db,
    create: (tenant: { tenantId: number; userId: number }, dbOverride?: unknown) => ({
      tenant,
      db: { raw: dbOverride ?? db },
    }),
  } as unknown as PlatformContextFactory;
  await consignmentRoutes(app, ctxFactory);
  return app;
}

const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['CONSIGNMENT_VIEW'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });

const routes: Array<{
  method: 'GET' | 'POST';
  url: string;
  permission: string;
  payload?: unknown;
}> = [
  {
    method: 'POST',
    url: '/consignment/receive',
    permission: 'CONSIGNMENT_RECEIVE',
    payload: {
      supplierId: 1,
      itemId: 1,
      warehouseId: 1,
      receivedQty: 1,
      agreedRate: 1,
      receivedDate: new Date().toISOString(),
    },
  },
  { method: 'GET', url: '/consignment/stock', permission: 'CONSIGNMENT_VIEW' },
  { method: 'GET', url: '/consignment/settlements', permission: 'CONSIGNMENT_VIEW' },
  {
    method: 'POST',
    url: '/consignment/settlements',
    permission: 'CONSIGNMENT_SETTLE',
    payload: {
      supplierId: 1,
      periodFrom: new Date().toISOString(),
      periodTo: new Date().toISOString(),
    },
  },
  {
    method: 'POST',
    url: '/consignment/settle/1',
    permission: 'CONSIGNMENT_SETTLE',
    payload: { paymentReference: 'ref' },
  },
  {
    method: 'POST',
    url: '/consignment/return/1',
    permission: 'CONSIGNMENT_RETURN',
    payload: { returnQty: 1 },
  },
];

describe('consignment.routes.ts authorization (Phase 9 tenantScopedHandler migration)', () => {
  for (const route of routes) {
    it(`${route.method} ${route.url} — 401 with no token`, async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: route.method,
        url: route.url,
        payload: route.payload,
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it(`${route.method} ${route.url} — 403 without ${route.permission}`, async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { Authorization: `Bearer ${await ordinaryToken()}` },
        payload: route.payload,
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }

  it('GET /consignment/stock — 200 for a real caller (proves tenantScopedHandler wiring)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/consignment/stock',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
    await app.close();
  });
});
