// Phase 3A (HR_PAYROLL capability) — payroll.routes.ts's 13 user-facing routes are gated by
// requireCapability('HR_PAYROLL') + requirePermission(...) as preHandlers, mirroring the exact
// pattern proven in near-expiry-stock-route.test.ts for INVENTORY_BATCH. The two internal
// scheduler routes (/internal/payroll/prepare, /internal/payroll/send-slips) are deliberately
// NOT gated (D2, requireInternalKey-only, no request.auth) and are not tested here.
//
// requireCapability()'s own 403/503/tenant-isolation behavior is already exhaustively covered
// by packages/platform-sdk/test/integration/capability-guard-route.test.ts; this test proves
// only that payroll.routes.ts wires it correctly (right capability key, right db/redis args,
// preHandler ordering) and that requirePermission composes with it as an independent second
// gate, using GET /payroll-runs as the representative route.
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
  payrollRuns: { __name: 'payrollRuns' },
  payrollSlips: { __name: 'payrollSlips' },
  employees: { __name: 'employees' },
  employeeSalaries: { __name: 'employeeSalaries' },
  salaryStructures: { __name: 'salaryStructures' },
  designations: { __name: 'designations' },
  departments: { __name: 'departments' },
  organizationSettings: { __name: 'organizationSettings' },
  employeeHistory: { __name: 'employeeHistory' },
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  isNull: vi.fn(() => '__isNull__'),
  // withTenantConnection (via tenantScopedHandler in @erp/sdk) uses drizzle-orm's own sql
  // tagged template internally — a per-file vi.mock('drizzle-orm', ...) replaces the module
  // for every importer, so it must be included here too or the SET LOCAL call throws.
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

import { payrollRoutes } from '../api/payroll.routes.js';

let privateKey: KeyLike;

// The proxy's target is a bare `{}` and only a `get` trap is defined (no `ownKeys`/`has`), so
// `Object.keys()`/deep-equality still sees an empty object — this is why
// `toHaveBeenCalledWith('HR_PAYROLL', {}, {})` below still passes even though `.transaction()`
// and `.execute()` are made to behave specially: withTenantConnection (used internally by
// tenantScopedHandler, now that payroll.routes.ts is migrated) calls `pooledDb.transaction(cb)`
// and `trx.execute(sql...)` — a generic "return proxy" auto-chain would return the proxy
// synchronously without ever invoking `cb`, so those two props need real behavior.
function makeAutoChainDb(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
        if (prop === 'execute') return () => Promise.resolve();
        if (prop === 'transaction') return (cb: (trx: unknown) => unknown) => cb(proxy);
        return () => proxy;
      },
    }
  );
  return proxy;
}

function makeCtxFactory() {
  const autoChainDb = makeAutoChainDb();
  return {
    create: (
      _tenant: { tenantId: number; userId: number; correlationId: string },
      dbOverride?: unknown
    ) => ({
      db: { raw: dbOverride ?? autoChainDb },
      tenant: _tenant,
    }),
    rawDb: autoChainDb,
    getRedis: () => ({}),
  } as never;
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
      message: "This tenant's plan does not include HR_PAYROLL.",
      details: { capabilityKey: 'HR_PAYROLL' },
    },
  });
};
const DENY_RESOLUTION = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  await reply.code(503).send({
    error: {
      code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
      message: 'Unable to determine capability state. Please retry.',
      details: { capabilityKey: 'HR_PAYROLL' },
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
  await payrollRoutes(app, makeCtxFactory());
  return app;
}

describe('GET /payroll-runs', () => {
  it('registers requireCapability with HR_PAYROLL and the ctxFactory db/redis handles', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    expect(requireCapabilityMock).toHaveBeenCalledWith('HR_PAYROLL', {}, {});
    await app.close();
  });

  it('capability disabled -> 403 CAPABILITY_NOT_ENABLED (permission irrelevant, capability gate runs first)', async () => {
    requireCapabilityMock.mockReturnValue(DENY_CAPABILITY);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CAPABILITY_NOT_ENABLED');
    await app.close();
  });

  it('capability resolution failure -> 503 CAPABILITY_RESOLUTION_UNAVAILABLE', async () => {
    requireCapabilityMock.mockReturnValue(DENY_RESOLUTION);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CAPABILITY_RESOLUTION_UNAVAILABLE');
    await app.close();
  });

  it('capability enabled but missing PAYROLL_VIEW -> 403 FORBIDDEN', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    const token = await makeToken([]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN', message: `Missing permission: ${PERMISSIONS.PAYROLL_VIEW}` },
    });
    await app.close();
  });

  it('capability enabled + PAYROLL_VIEW granted -> 200', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('no Authorization header -> 401 UNAUTHORIZED, never reaches the capability check', async () => {
    requireCapabilityMock.mockReturnValue(ALLOW);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/payroll-runs' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
