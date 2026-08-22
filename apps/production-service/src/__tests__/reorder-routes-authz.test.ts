// Phase 9 GUC-per-request rollout — reorder.routes.ts authorization + wiring tests, migrated to
// tenantScopedHandler 2026-08-21. Mirrors bom-routes-authz.test.ts's/work-center-routes-authz.
// test.ts's pattern: mocked @erp/db + drizzle-orm, real RS256 JWT signing, fake
// ctxFactory.rawDb/create() satisfying @erp/sdk's tenantScopedHandler.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id' },
  suppliers: { __name: 'suppliers', id: 'id', tenantId: 'tenant_id' },
  purchaseOrders: { __name: 'purchase_orders', id: 'id' },
  purchaseOrderLines: { __name: 'purchase_order_lines' },
  projectionStockLevel: { __name: 'projection_stock_level' },
  outboxEvents: { __name: 'outbox_events' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  lte: vi.fn((a: unknown, b: unknown) => ({ __lte__: [a, b] })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ __inArray__: [a, b] })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

import { reorderRoutes } from '../api/reorder.routes.js';

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
    innerJoin: (_t?: unknown, _c?: unknown) => chain(result),
    where: (_c?: unknown) => chain(result),
  });
}

function makeFakeDb(): Record<string, unknown> {
  const db: Record<string, unknown> = {
    select: () => chain([]),
    // withTenantConnection (@erp/sdk) calls `trx.execute(sql\`SELECT set_config(...)\`)` before
    // invoking the callback — a no-op stand-in here, real GUC-setting behavior is covered by
    // platform-sdk/src/__tests__/tenantConnection.test.ts against a real Postgres connection.
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
  await reorderRoutes(app, ctxFactory);
  return app;
}

const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['REORDER_VIEW'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });

describe('reorder.routes.ts authorization (Phase 9 tenantScopedHandler migration)', () => {
  it('GET /inventory/reorder-required — 401 with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/inventory/reorder-required' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /inventory/reorder-required — 403 without REORDER_VIEW', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/inventory/reorder-required',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /inventory/reorder-required — 200 for a real caller', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/inventory/reorder-required',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
    await app.close();
  });

  it('POST /inventory/reorder/create-pos — 403 without REORDER_CREATE_PO', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/inventory/reorder/create-pos',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: {
        branchId: 1,
        warehouseId: 1,
        placeOfSupply: 'MH',
        items: [{ itemId: 1, supplierId: 1, quantity: 5, unitPrice: 10 }],
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
