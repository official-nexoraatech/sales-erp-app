// PG-028 — usage.routes.ts authorization + response-shape tests.
// See [[erp_db_vitest_barrel_export_bug]]: @erp/db's export * barrel can resolve stale
// symbols under vitest, so @erp/db and drizzle-orm are mocked with minimal stand-ins,
// mirroring tenant-admin-authz.test.ts's approach for the same route file family.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type * as ErpTypes from '@erp/types';

vi.mock('@erp/db', () => ({
  tenants: { __name: 'tenants' },
  usageSummary: { __name: 'usage_summary' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  desc: vi.fn((a: unknown) => ({ __desc__: a })),
}));

vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: { ...actual.PERMISSIONS, PLATFORM_TENANT_MANAGE: 'PLATFORM_TENANT_MANAGE' },
  };
});

import { ERPError } from '@erp/types';
import { usageRoutes } from '../api/usage.routes.js';

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

async function signToken(opts: { sub: string; tenantId: number; permissions: string[] }): Promise<string> {
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
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

// A thenable chain object that satisfies both `await db.select()...` and
// `.where()`/`.orderBy()` continuation, without modeling real query filtering — this suite
// tests route wiring/authz/response-shape, not drizzle query correctness.
function chain(result: unknown): unknown {
  return Object.assign(Promise.resolve(result), {
    where: (_c?: unknown) => chain(result),
    orderBy: (_c?: unknown) => chain(result),
  });
}

interface FakeState {
  tenant?: Record<string, unknown>;
  allTenants?: Record<string, unknown>[];
  usageSummaryRows?: Record<string, unknown>[];
}

function makeFakeDb(state: FakeState): Record<string, unknown> {
  return {
    select: (cols?: unknown) => ({
      from: (table: { __name: string }) => {
        if (table.__name === 'tenants') {
          return cols ? chain(state.allTenants ?? []) : chain(state.tenant ? [state.tenant] : []);
        }
        if (table.__name === 'usage_summary') {
          return chain(state.usageSummaryRows ?? []);
        }
        return chain([]);
      },
    }),
  };
}

async function buildApp(db: Record<string, unknown>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await usageRoutes(app, db as never);
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });
  return app;
}

describe('PG-028 — GET /admin/tenants/:id/usage', () => {
  it('1. no token → 401', async () => {
    const db = makeFakeDb({ tenant: { id: 2, settings: {} } });
    const app = await buildApp(db);

    const res = await app.inject({ method: 'GET', url: '/admin/tenants/2/usage' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('2. valid token lacking PLATFORM_TENANT_MANAGE → 403', async () => {
    const db = makeFakeDb({ tenant: { id: 2, settings: {} } });
    const app = await buildApp(db);
    const token = await signToken({ sub: '1', tenantId: 1, permissions: ['INVOICE_VIEW'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/usage',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('3. platform-operator, no usage_summary row yet → 200 with zeros + entitlements from tenant.settings', async () => {
    const db = makeFakeDb({ tenant: { id: 2, settings: { maxUsers: 25, maxBranches: 5 } } });
    const app = await buildApp(db);
    const token = await signToken({ sub: '99', tenantId: 999, permissions: ['PLATFORM_TENANT_MANAGE'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/usage?period=2026-07',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      period: '2026-07',
      invoiceCount: 0,
      activeUserCount: 0,
      storageBytes: 0,
      apiCallCount: 0,
      entitlements: { maxUsers: 25, maxBranches: 5 },
    });
    await app.close();
  });

  it('4. platform-operator, usage_summary row present → 200 with real numbers', async () => {
    const db = makeFakeDb({
      tenant: { id: 2, settings: { maxUsers: 25, maxBranches: 5 } },
      usageSummaryRows: [
        { tenantId: 2, invoiceCount: 7, activeUserCount: 3, storageBytes: 2048, apiCallCount: 1500 },
      ],
    });
    const app = await buildApp(db);
    const token = await signToken({ sub: '99', tenantId: 999, permissions: ['PLATFORM_TENANT_MANAGE'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/usage?period=2026-07',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ invoiceCount: 7, activeUserCount: 3, storageBytes: 2048, apiCallCount: 1500 });
    await app.close();
  });

  it('5. malformed period → 400', async () => {
    const db = makeFakeDb({ tenant: { id: 2, settings: {} } });
    const app = await buildApp(db);
    const token = await signToken({ sub: '99', tenantId: 999, permissions: ['PLATFORM_TENANT_MANAGE'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/usage?period=not-a-period',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('6. tenant not found → 404', async () => {
    const db = makeFakeDb({});
    const app = await buildApp(db);
    const token = await signToken({ sub: '99', tenantId: 999, permissions: ['PLATFORM_TENANT_MANAGE'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/999999/usage',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('PG-028 — GET /admin/tenants/usage-overview', () => {
  it('1. no token → 401', async () => {
    const db = makeFakeDb({ allTenants: [] });
    const app = await buildApp(db);

    const res = await app.inject({ method: 'GET', url: '/admin/tenants/usage-overview' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('2. valid token lacking PLATFORM_TENANT_MANAGE → 403', async () => {
    const db = makeFakeDb({ allTenants: [] });
    const app = await buildApp(db);
    const token = await signToken({ sub: '1', tenantId: 1, permissions: ['INVOICE_VIEW'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/usage-overview',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('3. platform-operator → 200 with all tenants, defaulting to zeros when no summary row exists', async () => {
    const db = makeFakeDb({
      allTenants: [
        { id: 1, name: 'Acme' },
        { id: 2, name: 'Globex' },
      ],
      usageSummaryRows: [{ tenantId: 1, invoiceCount: 4, activeUserCount: 2, storageBytes: 512, apiCallCount: 99 }],
    });
    const app = await buildApp(db);
    const token = await signToken({ sub: '99', tenantId: 999, permissions: ['PLATFORM_TENANT_MANAGE'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/usage-overview?period=2026-07',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { content: Array<Record<string, unknown>> } };
    expect(body.data.content).toHaveLength(2);
    expect(body.data.content[0]).toMatchObject({ tenantId: 1, tenantName: 'Acme', invoiceCount: 4 });
    expect(body.data.content[1]).toMatchObject({ tenantId: 2, tenantName: 'Globex', invoiceCount: 0 });
    await app.close();
  });
});
