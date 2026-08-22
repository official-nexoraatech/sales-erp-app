// Manufacturing vertical, Phase B — work-center.routes.ts authorization + behavior tests.
// Mirrors bom-routes-authz.test.ts's exact pattern (mocked @erp/db, real RS256 JWT signing,
// fake ctxFactory.rawDb/create() satisfying @erp/sdk's tenantScopedHandler).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { PlatformContextFactory } from '@erp/sdk';

vi.mock('@erp/db', () => ({
  workCenters: {
    __name: 'work_centers',
    id: 'id',
    tenantId: 'tenant_id',
    code: 'code',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { workCenterRoutes } from '../api/work-center.routes.js';

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

interface FakeState {
  existing?: Record<string, unknown>;
  listRows?: Record<string, unknown>[];
  newId?: number;
}

function makeFakeDb(state: FakeState): Record<string, unknown> {
  const db: Record<string, unknown> = {
    select: () => ({
      from: () => chain(state.listRows ?? (state.existing ? [state.existing] : [])),
    }),
    insert: () => ({
      values: () =>
        Object.assign(Promise.resolve([]), {
          returning: async () => [{ id: state.newId ?? 1 }],
        }),
    }),
    update: () => ({
      set: () => ({ where: async () => [] }),
    }),
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
  await workCenterRoutes(app, ctxFactory);
  return app;
}

const creatorToken = () =>
  signToken({ sub: '1', tenantId: 1, permissions: ['WORK_CENTER_CREATE', 'WORK_CENTER_VIEW'] });
const viewerToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['WORK_CENTER_VIEW'] });
const updaterToken = () =>
  signToken({ sub: '1', tenantId: 1, permissions: ['WORK_CENTER_UPDATE'] });
const ordinaryToken = () => signToken({ sub: '1', tenantId: 1, permissions: ['JOB_WORK_VIEW'] });

describe('Manufacturing Phase B — work-center.routes.ts authorization', () => {
  it('POST /work-centers — 401 with no token', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/work-centers',
      payload: { name: 'A', code: 'A1' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /work-centers — 403 without WORK_CENTER_CREATE', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/work-centers',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: { name: 'A', code: 'A1' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /work-centers — 201 for a real caller', async () => {
    const app = await buildApp({ newId: 7 });
    const res = await app.inject({
      method: 'POST',
      url: '/work-centers',
      headers: { Authorization: `Bearer ${await creatorToken()}` },
      payload: { name: 'Cutting Station', code: 'CUT-1', capacityPerDay: 100 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ data: { id: 7 } });
    await app.close();
  });

  it('GET /work-centers — 403 without WORK_CENTER_VIEW', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/work-centers',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /work-centers — 200 with rows for a real caller', async () => {
    const app = await buildApp({ listRows: [{ id: 1, name: 'Cutting Station', tenantId: 1 }] });
    const res = await app.inject({
      method: 'GET',
      url: '/work-centers',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toHaveLength(1);
    await app.close();
  });

  it('GET /work-centers/:id — 404 for an unknown id', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/work-centers/999',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /work-centers/:id — 200 for a real caller', async () => {
    const app = await buildApp({ existing: { id: 5, name: 'Press A' } });
    const res = await app.inject({
      method: 'GET',
      url: '/work-centers/5',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('PUT /work-centers/:id — 403 without WORK_CENTER_UPDATE', async () => {
    const app = await buildApp({ existing: { id: 5 } });
    const res = await app.inject({
      method: 'PUT',
      url: '/work-centers/5',
      headers: { Authorization: `Bearer ${await viewerToken()}` },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PUT /work-centers/:id — 404 for an unknown id', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'PUT',
      url: '/work-centers/999',
      headers: { Authorization: `Bearer ${await updaterToken()}` },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('PUT /work-centers/:id — 200 for a real caller', async () => {
    const app = await buildApp({ existing: { id: 5 } });
    const res = await app.inject({
      method: 'PUT',
      url: '/work-centers/5',
      headers: { Authorization: `Bearer ${await updaterToken()}` },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
