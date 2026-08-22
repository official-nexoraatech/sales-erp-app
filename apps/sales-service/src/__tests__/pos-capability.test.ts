// Phase 3B (POS capability) — pos.routes.ts's 15 routes, day-end.routes.ts's 2 Z-report routes,
// and promotion.routes.ts's checkout-time evaluate route are all gated by
// requireCapability('POS') + requireAnyPermission/requirePermission as preHandlers (D3: all
// three files gated together as one capability boundary), mirroring the exact pattern proven
// in near-expiry-stock-route.test.ts for INVENTORY_BATCH.
//
// requireCapability()'s own 403/503/tenant-isolation behavior is already exhaustively covered
// by packages/platform-sdk/test/integration/capability-guard-route.test.ts; this test proves
// only that pos.routes.ts wires it correctly (right capability key, right db/redis args,
// preHandler ordering) and that requireAnyPermission composes with it as an independent second
// gate, using GET /pos/sessions/active as the representative route.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type * as ErpSdk from '@erp/sdk';

const { requireCapabilityMock } = vi.hoisted(() => ({
  requireCapabilityMock: vi.fn(),
}));

vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpSdk>();
  return { ...actual, requireCapability: requireCapabilityMock };
});

vi.mock('@erp/db', () => ({
  posSessions: { __name: 'posSessions' },
  posHeldSales: { __name: 'posHeldSales' },
  invoices: { __name: 'invoices' },
  invoiceLines: { __name: 'invoiceLines' },
  items: { __name: 'items' },
  customers: { __name: 'customers' },
  organizationSettings: { __name: 'organizationSettings' },
  paymentAllocations: { __name: 'paymentAllocations' },
  categories: { __name: 'categories' },
  brands: { __name: 'brands' },
  priceLists: { __name: 'priceLists' },
  priceListItems: { __name: 'priceListItems' },
  warehouses: { __name: 'warehouses' },
  projectionStockLevel: { __name: 'projectionStockLevel' },
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  isNull: vi.fn(() => '__isNull__'),
  sql: vi.fn(() => '__sql__'),
}));

import { posRoutes } from '../api/pos.routes.js';

let privateKey: KeyLike;

function makeAutoChainDb(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
        return () => proxy;
      },
    }
  );
  return proxy;
}

function makeCtxFactory() {
  const ctx = {
    db: { raw: makeAutoChainDb() },
    tenant: { tenantId: 1, userId: 1, correlationId: 'test' },
  };
  // tenantScopedHandler (used by pos.routes.ts's migrated routes) calls
  // withTenantConnection(ctxFactory.rawDb, ...), which needs .transaction()/.execute() on rawDb —
  // see the "missing execute stub in mocked-db authz tests" gotcha documented elsewhere in this
  // rollout (e.g. reorder-routes-authz.test.ts).
  const rawDb = {
    transaction: (cb: (trx: unknown) => unknown) => cb(makeAutoChainDb()),
    execute: async () => [],
  };
  return { create: () => ctx, rawDb, getRedis: () => ({}) } as never;
}

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
    .setIssuer('erp-auth-service')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

const ALLOW: (req: FastifyRequest, reply: FastifyReply) => Promise<void> = async () => {};
const DENY_CAPABILITY = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  await reply.code(403).send({
    error: {
      code: 'CAPABILITY_NOT_ENABLED',
      message: "This tenant's plan does not include POS.",
      details: { capabilityKey: 'POS' },
    },
  });
};
const DENY_RESOLUTION = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  await reply.code(503).send({
    error: {
      code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
      message: 'Unable to determine capability state. Please retry.',
      details: { capabilityKey: 'POS' },
    },
  });
};

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

afterEach(() => {
  requireCapabilityMock.mockReset();
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await posRoutes(app, makeCtxFactory());
  return app;
}

describe('GET /pos/sessions/active', () => {
  it('registers requireCapability with POS and the ctxFactory db/redis handles', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    expect(requireCapabilityMock).toHaveBeenCalledWith(
      'POS',
      expect.objectContaining({ transaction: expect.any(Function), execute: expect.any(Function) }),
      {}
    );
    await app.close();
  });

  it('capability disabled -> 403 CAPABILITY_NOT_ENABLED (permission irrelevant, capability gate runs first)', async () => {
    requireCapabilityMock.mockReturnValue(DENY_CAPABILITY);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.POS_ACCESS]);

    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CAPABILITY_NOT_ENABLED');
    await app.close();
  });

  it('capability resolution failure -> 503 CAPABILITY_RESOLUTION_UNAVAILABLE', async () => {
    requireCapabilityMock.mockReturnValue(DENY_RESOLUTION);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.POS_ACCESS]);

    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CAPABILITY_RESOLUTION_UNAVAILABLE');
    await app.close();
  });

  it('capability enabled but missing POS_ACCESS/POS_MANAGE -> 403 FORBIDDEN', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    const token = await makeToken([]);

    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('capability enabled + POS_ACCESS granted -> 200', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.POS_ACCESS]);

    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('no Authorization header -> 401 UNAUTHORIZED, never reaches the capability check', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/pos/sessions/active' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
