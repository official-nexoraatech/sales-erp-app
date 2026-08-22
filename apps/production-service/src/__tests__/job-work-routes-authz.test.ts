// Phase 9 GUC-per-request rollout — job-work.routes.ts authorization + wiring tests, migrated to
// tenantScopedHandler 2026-08-21. Focuses on the 401/403 boundary for every route (this runs in
// the authenticate/requirePermission preHandlers, before the handler body — and therefore before
// any DB interaction — so it doesn't need per-route domain-accurate mocking) plus one 200
// success-path check proving the tenantScopedHandler wiring itself works end-to-end for this
// route file. The domain logic (JobWorkOrderService itself) is already thoroughly covered by
// job-work-order-valuation.integration.test.ts, job-work-order-bom.integration.test.ts,
// job-work-order-work-center.integration.test.ts, and job-work-material-issue-fefo.integration.
// test.ts against a real database.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  jobWorkOrders: {
    __name: 'job_work_orders',
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    expectedDate: 'expected_date',
    completedAt: 'completed_at',
  },
  jobWorkOrderMaterials: { __name: 'job_work_order_materials' },
  jobWorkOrderQualityChecks: { __name: 'job_work_order_quality_checks' },
  jobWorkOrderHistory: { __name: 'job_work_order_history' },
  inventoryLedger: { __name: 'inventory_ledger' },
  projectionStockLevel: { __name: 'projection_stock_level' },
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id' },
  suppliers: { __name: 'suppliers', id: 'id', tenantId: 'tenant_id' },
  workCenters: { __name: 'work_centers', id: 'id', tenantId: 'tenant_id' },
  outboxEvents: { __name: 'outbox_events' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  gte: vi.fn((a: unknown, b: unknown) => ({ __gte__: [a, b] })),
  desc: vi.fn((a: unknown) => ({ __desc__: a })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ __inArray__: [a, b] })),
  getTableColumns: vi.fn(() => ({})),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

import { jobWorkRoutes } from '../api/job-work.routes.js';

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
    orderBy: (_c?: unknown) => chain(result),
    limit: (_n?: unknown) => chain(result),
    offset: (_n?: unknown) => chain(result),
    leftJoin: (_t?: unknown, _c?: unknown) => chain(result),
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
  await jobWorkRoutes(app, ctxFactory);
  return app;
}

const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['REORDER_VIEW'] });

const routes: Array<{
  method: 'GET' | 'POST';
  url: string;
  permission: string;
  payload?: unknown;
}> = [
  { method: 'GET', url: '/job-work-orders', permission: 'JOB_WORK_VIEW' },
  { method: 'GET', url: '/job-work-orders/in-progress', permission: 'JOB_WORK_VIEW' },
  { method: 'GET', url: '/job-work-orders/dashboard', permission: 'JOB_WORK_VIEW' },
  {
    method: 'POST',
    url: '/job-work-orders',
    permission: 'JOB_WORK_CREATE',
    payload: {
      supplierId: 1,
      branchId: 1,
      warehouseId: 1,
      outputItemId: 1,
      orderedQty: 1,
      jobWorkRate: 1,
      orderDate: new Date().toISOString(),
      materials: [],
    },
  },
  { method: 'GET', url: '/job-work-orders/1', permission: 'JOB_WORK_VIEW' },
  {
    method: 'POST',
    url: '/job-work-orders/1/issue-materials',
    permission: 'JOB_WORK_ISSUE_MATERIALS',
  },
  {
    method: 'POST',
    url: '/job-work-orders/1/start-quality-check',
    permission: 'JOB_WORK_QUALITY_CHECK',
  },
  {
    method: 'POST',
    url: '/job-work-orders/1/quality-checks',
    permission: 'JOB_WORK_QUALITY_CHECK',
    payload: { entries: [{ pieceNumber: 1, result: 'PASS' }] },
  },
  {
    method: 'POST',
    url: '/job-work-orders/1/complete',
    permission: 'JOB_WORK_COMPLETE',
    payload: { receivedQty: 1, rejectedQty: 0, scrapQty: 0 },
  },
  {
    method: 'POST',
    url: '/job-work-orders/1/cancel',
    permission: 'JOB_WORK_CANCEL',
    payload: { reason: 'test' },
  },
];

describe('job-work.routes.ts authorization (Phase 9 tenantScopedHandler migration)', () => {
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

  it('GET /job-work-orders/dashboard — 200 for a real caller (proves tenantScopedHandler wiring)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/job-work-orders/dashboard',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { pending: 0, overdue: 0, completedToday: 0 } });
    await app.close();
  });
});
