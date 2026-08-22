// Manufacturing vertical, Phase A — bom.routes.ts authorization + behavior tests.
// Mirrors tenant-service's billing-routes-authz.test.ts/usage-routes-authz.test.ts pattern:
// mocked @erp/db + drizzle-orm stand-ins, real RS256 JWT signing via jose, real authenticate/
// requirePermission middleware. bom.routes.ts (Phase 9 GUC-per-request pilot) wraps each handler
// in @erp/sdk's tenantScopedHandler rather than calling ctxFactory.create() directly — this test
// fakes ctxFactory.rawDb/create() rather than exercising a real Postgres transaction (that
// mechanism is covered by its own real-DB test, platform-sdk/src/__tests__/
// tenantConnection.test.ts). Keeps this suite fast and DB-free, same as before.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  boms: {
    __name: 'boms',
    id: 'id',
    tenantId: 'tenant_id',
    finishedItemId: 'finished_item_id',
    finishedVariantId: 'finished_variant_id',
    isActive: 'is_active',
  },
  bomLines: { __name: 'bom_lines', bomId: 'bom_id', tenantId: 'tenant_id' },
  items: { __name: 'items', id: 'id', tenantId: 'tenant_id', purchasePrice: 'purchase_price' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  isNull: vi.fn((a: unknown) => ({ __isNull__: a })),
  // @erp/sdk's withTenantConnection (used by tenantScopedHandler) also imports `sql` from
  // drizzle-orm — this mock is global per module, so it needs a stand-in too or that internal
  // call throws "sql is not a function".
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { bomRoutes } from '../api/bom.routes.js';

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
  });
}

// Multi-level BOM (2026-08-22): BOMService now issues a THIRD shape of `select().from(boms)`
// query per component line — "does this component have its own ACTIVE BOM?"
// (`eq(boms.finishedItemId, componentItemId) AND eq(boms.isActive, true)`), on top of the two
// pre-existing shapes this mock already needed to tell apart: "look up the BOM by its own id"
// (getById()/explode()'s top-level lookup) and "list BOMs for a finished item, any status"
// (listForItem(), no isActive filter). This test's fixtures have no sub-assemblies, so the new
// finishedItemId+isActive shape always resolves empty (no sub-BOM found) — everything else keeps
// its original behavior.
function conditionMentionsColumn(cond: unknown, column: string): boolean {
  if (!cond || typeof cond !== 'object') return false;
  const c = cond as { __eq__?: unknown[]; __and__?: unknown[] };
  if (c.__eq__) return c.__eq__[0] === column;
  if (c.__and__) return c.__and__.some((a) => conditionMentionsColumn(a, column));
  return false;
}

interface FakeState {
  finishedItem?: Record<string, unknown>;
  bom?: Record<string, unknown>;
  bomLines?: Record<string, unknown>[];
  newBomId?: number;
}

function makeFakeDb(state: FakeState): Record<string, unknown> {
  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: { __name: string }) => {
        if (table.__name === 'items') return chain(state.finishedItem ? [state.finishedItem] : []);
        if (table.__name === 'boms') {
          return {
            where: (cond: unknown) => {
              // Sub-assembly check (multi-level BOM's cycle-guard/explode-recursion): a
              // finishedItemId lookup that also filters isActive — this test's fixtures have no
              // sub-assemblies, so it always resolves empty.
              if (
                conditionMentionsColumn(cond, 'finished_item_id') &&
                conditionMentionsColumn(cond, 'is_active')
              ) {
                return chain([]);
              }
              return chain(state.bom ? [state.bom] : []);
            },
          };
        }
        if (table.__name === 'bom_lines') return chain(state.bomLines ?? []);
        return chain([]);
      },
    }),
    update: () => ({
      set: () => ({ where: async () => [] }),
    }),
    delete: () => ({ where: async () => [] }),
    insert: (table: { __name: string }) => ({
      values: () =>
        Object.assign(Promise.resolve([]), {
          returning: async () => (table.__name === 'boms' ? [{ id: state.newBomId ?? 1 }] : []),
        }),
    }),
    // withTenantConnection (@erp/sdk) calls `trx.execute(sql\`SELECT set_config(...)\`)` before
    // invoking the callback — a no-op stand-in here, real GUC-setting behavior is covered by
    // tenantConnection.test.ts against a real Postgres connection.
    execute: async () => [],
    transaction: async (cb: (trx: Record<string, unknown>) => Promise<unknown>) => cb(db),
  };
  return db;
}

async function buildApp(state: FakeState): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const db = makeFakeDb(state);
  // tenantScopedHandler (@erp/sdk) calls ctxFactory.rawDb.transaction(...) then
  // ctxFactory.create(tenant, scopedDb) — this fake satisfies both without a real Postgres
  // connection, mirroring how the real PlatformContextFactory is used but with the mocked db.
  const ctxFactory = {
    rawDb: db,
    create: (tenant: { tenantId: number; userId: number }, dbOverride?: unknown) => ({
      tenant,
      db: { raw: dbOverride ?? db },
    }),
  } as unknown as PlatformContextFactory;
  await bomRoutes(app, ctxFactory);
  return app;
}

const creatorToken = () =>
  signToken({ sub: '1', tenantId: 1, permissions: ['BOM_CREATE', 'BOM_VIEW'] });
const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['BOM_VIEW'] });
const deleterToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['BOM_DELETE'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });

describe('Manufacturing Phase A — bom.routes.ts authorization', () => {
  it('POST /boms — 401 with no token', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/boms',
      payload: {
        name: 'Widget BOM',
        finishedItemId: 1,
        lines: [{ componentItemId: 2, quantityPerOutput: 1 }],
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /boms — 403 without BOM_CREATE', async () => {
    const app = await buildApp({ finishedItem: { id: 1 } });
    const res = await app.inject({
      method: 'POST',
      url: '/boms',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: {
        name: 'Widget BOM',
        finishedItemId: 1,
        lines: [{ componentItemId: 2, quantityPerOutput: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /boms — 201 for a real caller with BOM_CREATE', async () => {
    const app = await buildApp({ finishedItem: { id: 1 }, newBomId: 42 });
    const res = await app.inject({
      method: 'POST',
      url: '/boms',
      headers: { Authorization: `Bearer ${await creatorToken()}` },
      payload: {
        name: 'Widget BOM',
        finishedItemId: 1,
        lines: [{ componentItemId: 2, quantityPerOutput: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ data: { id: 42 } });
    await app.close();
  });

  it('POST /boms — 404 when the finished item does not belong to this tenant', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/boms',
      headers: { Authorization: `Bearer ${await creatorToken()}` },
      payload: {
        name: 'Widget BOM',
        finishedItemId: 999,
        lines: [{ componentItemId: 2, quantityPerOutput: 1 }],
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /boms/:id — 403 without BOM_VIEW', async () => {
    const app = await buildApp({ bom: { id: 1, isActive: true, outputQty: '1' } });
    const res = await app.inject({
      method: 'GET',
      url: '/boms/1',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /boms/:id — 200 with bom + lines for a real caller', async () => {
    const app = await buildApp({
      bom: { id: 1, isActive: true, outputQty: '1' },
      bomLines: [
        { id: 1, bomId: 1, componentItemId: 2, quantityPerOutput: '3', scrapPercent: '0' },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/boms/1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { bom: { id: number }; lines: unknown[] } };
    expect(body.data.bom.id).toBe(1);
    expect(body.data.lines).toHaveLength(1);
    await app.close();
  });

  it('GET /boms/:id — 404 for an unknown BOM', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/boms/999',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /boms/:id/explode — 200 with scaled quantities', async () => {
    const app = await buildApp({
      bom: { id: 1, isActive: true, outputQty: '2' },
      bomLines: [
        {
          id: 1,
          bomId: 1,
          componentItemId: 2,
          componentVariantId: null,
          quantityPerOutput: '4',
          scrapPercent: '10',
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/boms/1/explode?qty=4',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    // outputQty of the BOM is 2, requested qty is 4 → scale factor 2. 4 * 2 * 1.10 = 8.8
    expect(res.json()).toEqual({ data: { lines: [{ componentItemId: 2, requiredQty: 8.8 }] } });
    await app.close();
  });

  it('GET /boms/:id/explode — 422 when the BOM is inactive', async () => {
    const app = await buildApp({ bom: { id: 1, isActive: false, outputQty: '1' } });
    const res = await app.inject({
      method: 'GET',
      url: '/boms/1/explode?qty=1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('GET /boms/for-item/:itemId — 403 without BOM_VIEW', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/boms/for-item/1',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /boms/for-item/:itemId — 200 for a real caller', async () => {
    const app = await buildApp({
      bom: { id: 1, finishedItemId: 1, isActive: true, outputQty: '1' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/boms/for-item/1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    await app.close();
  });

  it('DELETE /boms/:id — 401 with no token', async () => {
    const app = await buildApp({});
    const res = await app.inject({ method: 'DELETE', url: '/boms/1' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('DELETE /boms/:id — 403 without BOM_DELETE', async () => {
    const app = await buildApp({ bom: { id: 1, isActive: false } });
    const res = await app.inject({
      method: 'DELETE',
      url: '/boms/1',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('DELETE /boms/:id — 422 when the BOM is currently active', async () => {
    const app = await buildApp({ bom: { id: 1, isActive: true } });
    const res = await app.inject({
      method: 'DELETE',
      url: '/boms/1',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('DELETE /boms/:id — 404 for an unknown BOM', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'DELETE',
      url: '/boms/999',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /boms/:id — 204 for a real caller when the BOM is not active', async () => {
    const app = await buildApp({ bom: { id: 1, isActive: false } });
    const res = await app.inject({
      method: 'DELETE',
      url: '/boms/1',
      headers: { Authorization: `Bearer ${await deleterToken()}` },
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});
