// Capability Foundation (Phase 1) — GET /users/me now computes `enabledCapabilities`
// (Decision 1, 08-frontend-navigation.md §2). This is UX/navigation-filtering data only,
// not a security boundary; proves: (a) enabled capabilities are listed, (b) disabled ones
// are excluded, (c) a per-key resolution failure is treated as absent (fail-closed) rather
// than failing the whole /me response.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';

const { isCapabilityEnabledMock } = vi.hoisted(() => ({
  isCapabilityEnabledMock: vi.fn<(key: string, tenantId: number) => Promise<boolean>>(),
}));

vi.mock('@erp/sdk', () => ({
  assertUnderUserLimit: vi.fn(async () => {}),
  acquireTenantLimitLock: vi.fn(async () => {}),
  isCapabilityEnabled: isCapabilityEnabledMock,
  assertTenantActive: vi.fn(async () => {}),
}));

vi.mock('@erp/db', () => ({
  users: { __name: 'users' },
  roles: { __name: 'roles' },
  userRoles: { __name: 'userRoles' },
  userBranches: { __name: 'userBranches' },
  rolePermissions: { __name: 'rolePermissions' },
  tenants: { __name: 'tenants' },
  branches: { __name: 'branches' },
  refreshTokens: { __name: 'refreshTokens', userId: '__refreshTokens.userId__' },
  securityAuditLog: { __name: 'securityAuditLog' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  isNull: vi.fn(() => '__isNull__'),
  ne: vi.fn(() => '__ne__'),
  inArray: vi.fn(() => '__inArray__'),
  sql: vi.fn(() => '__count__'),
}));

import { users, userRoles, userBranches } from '@erp/db';
import { userRoutes } from '../routes/users.js';
import { authenticate } from '../middleware/authenticate.js';
import { initializeJwt, signAccessToken } from '../jwt.js';

const TEST_ISSUER = 'erp-auth-service-users-me-capabilities-test';

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await initializeJwt({
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    issuer: TEST_ISSUER,
    accessTokenTtlSeconds: 900,
  });
});

function tokenFor(opts: { sub: string; tenantId: number }): Promise<string> {
  return signAccessToken({
    sub: opts.sub,
    tenantId: opts.tenantId,
    email: 'test@testco.com',
    roles: [],
    permissions: [],
  });
}

function selectResult(rows: unknown[]): unknown {
  return Object.assign(Promise.resolve(rows), {
    where: (_cond?: unknown) => Promise.resolve(rows),
  });
}

function makeFakeDb(user: Record<string, unknown>) {
  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === users) return selectResult([user]);
        if (table === userRoles) return selectResult([]);
        if (table === userBranches) return selectResult([]);
        return selectResult([]);
      },
    }),
  };
  return db;
}

function makeFakeCtxFactory(db: ReturnType<typeof makeFakeDb>): {
  create: () => unknown;
  rawDb: unknown;
  getRedis: () => unknown;
} {
  return {
    create: () => ({ db: { raw: db } }),
    rawDb: {}, // opaque — isCapabilityEnabled is mocked, never actually touches this
    getRedis: () => ({}),
  };
}

async function buildApp(db: ReturnType<typeof makeFakeDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Mirrors main.ts's real wiring: authenticate runs as a route-group preHandler hook,
  // not inline on /users/me itself (confirmed — GET /users/me has no explicit preHandler).
  app.addHook('preHandler', authenticate);
  await userRoutes(app, makeFakeCtxFactory(db) as never);
  return app;
}

describe('GET /users/me — enabledCapabilities', () => {
  it('includes only capabilities that resolve enabled, excludes disabled ones', async () => {
    isCapabilityEnabledMock.mockImplementation(async (key: string) => key === 'HR_PAYROLL');
    const db = makeFakeDb({ id: 1, tenantId: 1, email: 'test@testco.com' });
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { enabledCapabilities: string[] } };
    expect(body.data.enabledCapabilities).toEqual(['HR_PAYROLL']);
    await app.close();
  });

  it('treats a per-key resolution failure as absent (fail-closed) without failing the whole response', async () => {
    isCapabilityEnabledMock.mockImplementation(async (key: string) => {
      if (key === 'POS') throw new Error('Simulated DB/Redis failure');
      return key === 'HR_PAYROLL'; // only HR_PAYROLL resolves enabled; INVENTORY_BATCH stays off
    });
    const db = makeFakeDb({ id: 1, tenantId: 1, email: 'test@testco.com' });
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { enabledCapabilities: string[] } };
    expect(body.data.enabledCapabilities).toEqual(['HR_PAYROLL']);
    expect(body.data.enabledCapabilities).not.toContain('POS');
    await app.close();
  });

  it('does not change any existing field on the /me response (additive only)', async () => {
    isCapabilityEnabledMock.mockResolvedValue(false);
    const db = makeFakeDb({ id: 1, tenantId: 1, email: 'test@testco.com', firstName: 'Test' });
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data['email']).toBe('test@testco.com');
    expect(body.data['firstName']).toBe('Test');
    expect(body.data['roleIds']).toEqual([]);
    expect(body.data['branches']).toEqual([]);
    await app.close();
  });
});
