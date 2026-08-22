// Manufacturing vertical — routing.routes.ts authorization + behavior tests, mirroring
// bom-routes-authz.test.ts's own mocked-db pattern.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  routings: {
    __name: 'routings',
    id: 'id',
    tenantId: 'tenant_id',
    finishedItemId: 'finished_item_id',
    finishedVariantId: 'finished_variant_id',
    isActive: 'is_active',
  },
  routingOperations: {
    __name: 'routing_operations',
    routingId: 'routing_id',
    tenantId: 'tenant_id',
  },
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id' },
  workCenters: { __name: 'work_centers', id: 'id', tenantId: 'tenant_id' },
  productionOrders: { __name: 'production_orders', tenantId: 'tenant_id', routingId: 'routing_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  isNull: vi.fn((a: unknown) => ({ __isNull__: a })),
  asc: vi.fn((a: unknown) => ({ __asc__: a })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { routingRoutes } from '../api/routing.routes.js';

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
    where: (_c?: unknown) => chain(result),
    orderBy: (_c?: unknown) => chain(result),
    limit: (_n?: unknown) => chain(result),
  });
}

interface FakeState {
  finishedItem?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  operations?: Record<string, unknown>[];
  referencingOrder?: Record<string, unknown>;
}

function makeFakeDb(state: FakeState): Record<string, unknown> {
  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: { __name: string }) => {
        if (table.__name === 'items') return chain(state.finishedItem ? [state.finishedItem] : []);
        if (table.__name === 'routings') return chain(state.routing ? [state.routing] : []);
        if (table.__name === 'routing_operations') return chain(state.operations ?? []);
        if (table.__name === 'production_orders')
          return chain(state.referencingOrder ? [state.referencingOrder] : []);
        return chain([]);
      },
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: (table: { __name: string }) => ({
      values: () =>
        Object.assign(Promise.resolve([]), {
          returning: async () => (table.__name === 'routings' ? [{ id: 1 }] : []),
        }),
    }),
    delete: () => ({ where: async () => [] }),
    execute: async () => [],
    transaction: async (cb: (trx: Record<string, unknown>) => Promise<unknown>) => cb(db),
  };
  return db;
}

async function buildApp(state: FakeState): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const db = makeFakeDb(state);
  const ctxFactory = {
    rawDb: db,
    create: (tenant: { tenantId: number; userId: number }, dbOverride?: unknown) => ({
      tenant,
      db: { raw: dbOverride ?? db },
    }),
  } as unknown as PlatformContextFactory;
  await routingRoutes(app, ctxFactory);
  return app;
}

const creatorToken = () =>
  signToken({ sub: '1', tenantId: 1, permissions: ['ROUTING_CREATE', 'ROUTING_VIEW'] });
const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['ROUTING_VIEW'] });
const deleterToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['ROUTING_DELETE'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });

describe('routing.routes.ts authorization', () => {
  it('POST /routings — 401 with no token', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/routings',
      payload: {
        name: 'R1',
        finishedItemId: 1,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /routings — 403 without ROUTING_CREATE', async () => {
    const app = await buildApp({ finishedItem: { id: 1 } });
    const res = await app.inject({
      method: 'POST',
      url: '/routings',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: {
        name: 'R1',
        finishedItemId: 1,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /routings — 201 for a real caller with ROUTING_CREATE', async () => {
    const app = await buildApp({ finishedItem: { id: 1 } });
    const res = await app.inject({
      method: 'POST',
      url: '/routings',
      headers: { Authorization: `Bearer ${await creatorToken()}` },
      payload: {
        name: 'R1',
        finishedItemId: 1,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
      },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('POST /routings — 404 when the finished item does not belong to this tenant', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/routings',
      headers: { Authorization: `Bearer ${await creatorToken()}` },
      payload: {
        name: 'R1',
        finishedItemId: 999,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /routings/:id — 403 without ROUTING_VIEW', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /routings/:id — 200 with routing + operations for a real caller', async () => {
    const app = await buildApp({
      routing: { id: 1, isActive: true },
      operations: [{ id: 10, sequenceNo: 1, operationName: 'Cut' }],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { routing: unknown; operations: unknown[] } };
    expect(body.data.operations).toHaveLength(1);
    await app.close();
  });

  it('GET /routings/:id — 404 for an unknown routing', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /routings/for-item/:itemId — 403 without ROUTING_VIEW', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/routings/for-item/1',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('DELETE /routings/:id — 401 with no token', async () => {
    const app = await buildApp({});
    const res = await app.inject({ method: 'DELETE', url: '/routings/1' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('DELETE /routings/:id — 403 without ROUTING_DELETE', async () => {
    const app = await buildApp({ routing: { id: 1, isActive: false } });
    const res = await app.inject({
      method: 'DELETE',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('DELETE /routings/:id — 422 when the routing is currently active', async () => {
    const app = await buildApp({ routing: { id: 1, isActive: true } });
    const res = await app.inject({
      method: 'DELETE',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('DELETE /routings/:id — 422 when a production order still references it', async () => {
    const app = await buildApp({
      routing: { id: 1, isActive: false },
      referencingOrder: { id: 55 },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('DELETE /routings/:id — 404 for an unknown routing', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'DELETE',
      url: '/routings/999',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /routings/:id — 204 for a real caller when the routing is inactive and unreferenced', async () => {
    const app = await buildApp({ routing: { id: 1, isActive: false } });
    const res = await app.inject({
      method: 'DELETE',
      url: '/routings/1',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});
