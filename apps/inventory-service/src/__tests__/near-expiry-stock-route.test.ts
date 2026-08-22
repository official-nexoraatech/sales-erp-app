// Phase 2B (INVENTORY_BATCH capability) — GET /inventory/near-expiry-stock is gated by
// requireCapability('INVENTORY_BATCH') + requirePermission(BATCH_VIEW) as preHandlers (unlike
// item.routes.ts's in-handler check, this route is INVENTORY_BATCH-only end to end, so a
// top-level preHandler gate is correct here — see 27-affected-flow-matrix.md).
//
// requireCapability()'s own 403/503/tenant-isolation behavior is already exhaustively covered
// by packages/platform-sdk/test/integration/capability-guard-route.test.ts; this test proves
// only that stock.routes.ts wires it correctly (right capability key, right db/redis args,
// preHandler ordering) and that requirePermission(BATCH_VIEW) composes with it as an
// independent second gate — matching every other capability+permission route in this phase.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type * as ErpSdk from '@erp/sdk';

const { requireCapabilityMock } = vi.hoisted(() => ({
  requireCapabilityMock: vi.fn(),
}));

// Keeps authenticate/requirePermission/checkPermission real; only requireCapability is
// test-controlled (its own internals are covered elsewhere, see file header).
vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpSdk>();
  return { ...actual, requireCapability: requireCapabilityMock };
});

vi.mock('@erp/db', () => ({
  items: { __name: 'items' },
  warehouses: { __name: 'warehouses' },
  inventoryLedger: { __name: 'inventoryLedger' },
  projectionStockLevel: { __name: 'projectionStockLevel' },
  inventoryFifoLayers: { __name: 'inventoryFifoLayers' },
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  sql: vi.fn(() => '__sql__'),
  desc: vi.fn(() => '__desc__'),
  inArray: vi.fn(() => '__inArray__'),
  isNotNull: vi.fn(() => '__isNotNull__'),
  lte: vi.fn(() => '__lte__'),
}));

import { stockRoutes } from '../api/stock.routes.js';

let privateKey: KeyLike;

// Any method call returns the same proxy (infinitely chainable — select/from/innerJoin/where/
// orderBy/limit/offset in any order) and `await`-ing it at any point resolves to `[]`, which
// is exactly what this test needs: it only asserts on authorization outcomes, never on the
// near-expiry data itself (that's covered by the real-DB FEFO integration suite instead).
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
  const ctx = { db: { raw: makeAutoChainDb() } };
  return { create: () => ctx, rawDb: {}, getRedis: () => ({}) } as never;
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
      message: "This tenant's plan does not include INVENTORY_BATCH.",
      details: { capabilityKey: 'INVENTORY_BATCH' },
    },
  });
};
const DENY_RESOLUTION = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  await reply.code(503).send({
    error: {
      code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
      message: 'Unable to determine capability state. Please retry.',
      details: { capabilityKey: 'INVENTORY_BATCH' },
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
  await stockRoutes(app, makeCtxFactory());
  return app;
}

describe('GET /inventory/near-expiry-stock', () => {
  it('registers requireCapability with INVENTORY_BATCH and the ctxFactory db/redis handles', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    expect(requireCapabilityMock).toHaveBeenCalledWith('INVENTORY_BATCH', {}, {});
    await app.close();
  });

  it('capability disabled -> 403 CAPABILITY_NOT_ENABLED (permission irrelevant, capability gate runs first)', async () => {
    requireCapabilityMock.mockReturnValue(DENY_CAPABILITY);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.BATCH_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/inventory/near-expiry-stock',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CAPABILITY_NOT_ENABLED');
    await app.close();
  });

  it('capability resolution failure -> 503 CAPABILITY_RESOLUTION_UNAVAILABLE', async () => {
    requireCapabilityMock.mockReturnValue(DENY_RESOLUTION);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.BATCH_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/inventory/near-expiry-stock',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CAPABILITY_RESOLUTION_UNAVAILABLE');
    await app.close();
  });

  it('capability enabled but missing BATCH_VIEW -> 403 FORBIDDEN', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    const token = await makeToken([]);

    const res = await app.inject({
      method: 'GET',
      url: '/inventory/near-expiry-stock',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN', message: `Missing permission: ${PERMISSIONS.BATCH_VIEW}` },
    });
    await app.close();
  });

  it('capability enabled + BATCH_VIEW granted -> 200', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.BATCH_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/inventory/near-expiry-stock',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('no Authorization header -> 401 UNAUTHORIZED, never reaches the capability check', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/inventory/near-expiry-stock' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
