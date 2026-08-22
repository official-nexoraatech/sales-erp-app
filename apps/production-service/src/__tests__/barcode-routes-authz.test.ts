// Phase 9 GUC-per-request rollout — barcode.routes.ts authorization + wiring tests, migrated to
// tenantScopedHandler 2026-08-21. Same shape as job-work-routes-authz.test.ts: 401/403 boundary
// for every route (pre-handler, no DB needed) plus one 200 success-path check proving the
// tenantScopedHandler wiring works for a service that also depends on ctx.cache
// (BarcodeService(db, cache)) — see barcode-generation.test.ts for BarcodeService's own domain
// logic coverage.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  barcodeBatches: {
    __name: 'barcode_batches',
    id: 'id',
    tenantId: 'tenant_id',
    itemId: 'item_id',
    createdAt: 'created_at',
  },
  barcodes: { __name: 'barcodes', id: 'id', tenantId: 'tenant_id' },
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  desc: vi.fn((a: unknown) => ({ __desc__: a })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

import { barcodeRoutes } from '../api/barcode.routes.js';

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

const fakeCache = { get: async () => null, set: async () => undefined, del: async () => undefined };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const db = makeFakeDb();
  const ctxFactory = {
    rawDb: db,
    create: (tenant: { tenantId: number; userId: number }, dbOverride?: unknown) => ({
      tenant,
      db: { raw: dbOverride ?? db },
      cache: fakeCache,
    }),
  } as unknown as PlatformContextFactory;
  await barcodeRoutes(app, ctxFactory);
  return app;
}

const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['BARCODE_VIEW'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });

const routes: Array<{
  method: 'GET' | 'POST';
  url: string;
  permission: string;
  payload?: unknown;
}> = [
  {
    method: 'POST',
    url: '/barcodes/generate',
    permission: 'BARCODE_GENERATE',
    payload: { itemId: 1, quantity: 1, format: 'EAN13', printFormat: 'A4_SHEET' },
  },
  { method: 'GET', url: '/barcodes/print/1', permission: 'BARCODE_PRINT' },
  { method: 'POST', url: '/barcodes/1/deactivate', permission: 'BARCODE_GENERATE' },
  { method: 'GET', url: '/items/by-barcode/12345', permission: 'ITEM_VIEW' },
  { method: 'GET', url: '/barcodes/batches', permission: 'BARCODE_VIEW' },
];

describe('barcode.routes.ts authorization (Phase 9 tenantScopedHandler migration)', () => {
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

  it('GET /barcodes/batches — 200 for a real caller (proves tenantScopedHandler + ctx.cache wiring)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/barcodes/batches',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
    await app.close();
  });
});
