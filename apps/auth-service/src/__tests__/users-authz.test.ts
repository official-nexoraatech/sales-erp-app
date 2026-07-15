// ES-21 — auth-service user-management route authorization tests (C3)
//
// Regression coverage: before this phase, every route in users.ts relied only on
// the router-scope `authenticate` hook — any authenticated user (any role, any
// tenant) could list/create/update/delete users, lock/unlock accounts, reassign
// branches, and — most critically — reset another user's password with no
// permission check and no re-auth of their own identity.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import type * as ErpTypes from '@erp/types';

const { mockArgon2Verify, mockArgon2Hash } = vi.hoisted(() => ({
  mockArgon2Verify: vi.fn<[], Promise<boolean>>().mockResolvedValue(true),
  mockArgon2Hash: vi.fn<[], Promise<string>>().mockResolvedValue('$argon2id$test-hash'),
}));

vi.mock('argon2', () => ({
  default: { hash: mockArgon2Hash, verify: mockArgon2Verify, argon2id: 0 },
  hash: mockArgon2Hash,
  verify: mockArgon2Verify,
  argon2id: 0,
}));

vi.mock('@erp/db', () => ({
  users: { __name: 'users' },
  roles: { __name: 'roles' },
  userRoles: { __name: 'userRoles' },
  userBranches: { __name: 'userBranches' },
  rolePermissions: { __name: 'rolePermissions' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  isNull: vi.fn(() => '__isNull__'),
  ne: vi.fn(() => '__ne__'),
  inArray: vi.fn(() => '__inArray__'),
}));

// See security.test.ts for why: vitest can resolve '@erp/types' to a stale compiled
// permissions.js missing constants added by later phases — USER_MANAGE included.
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      USER_VIEW: 'USER_VIEW',
      USER_CREATE: 'USER_CREATE',
      USER_UPDATE: 'USER_UPDATE',
      USER_DELETE: 'USER_DELETE',
      USER_MANAGE: 'USER_MANAGE',
    },
  };
});

import { users, roles, rolePermissions } from '@erp/db';
import { userRoutes } from '../routes/users.js';
import { initializeJwt, signAccessToken } from '../jwt.js';

const TEST_ISSUER = 'erp-auth-service-users-authz-test';

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

function tokenFor(opts: { sub: string; tenantId: number; permissions: string[] }): Promise<string> {
  return signAccessToken({
    sub: opts.sub,
    tenantId: opts.tenantId,
    email: 'test@testco.com',
    roles: [],
    permissions: opts.permissions,
  });
}

// Mirrors the eq/and/inArray mocks above: every predicate is a no-op stand-in, so
// each store below is expected to hold only the row(s) relevant to a given test.
function makeFakeDb() {
  const store = {
    users: [] as Record<string, unknown>[],
    roles: [] as Record<string, unknown>[],
    rolePermissions: [] as Record<string, unknown>[],
  };

  function rowsFor(table: unknown): Record<string, unknown>[] {
    if (table === users) return store.users;
    if (table === roles) return store.roles;
    if (table === rolePermissions) return store.rolePermissions;
    return [];
  }

  function selectResult(rows: Record<string, unknown>[]): unknown {
    return Object.assign(Promise.resolve(rows.slice()), {
      where: (_cond?: unknown) => Promise.resolve(rows.slice()),
    });
  }

  const db = {
    select: (_fields?: unknown) => ({ from: (table: unknown) => selectResult(rowsFor(table)) }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = rowsFor(table);
        const inserted = (Array.isArray(val) ? val : [val]).map((v, i) => ({
          id: rows.length + i + 1,
          ...v,
        }));
        rows.push(...inserted);
        return Object.assign(Promise.resolve(inserted), { returning: async () => inserted });
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          rowsFor(table).forEach((row) => Object.assign(row, patch));
          return [];
        },
      }),
    }),
  };

  return { db, store };
}

// userRoutes now takes a PlatformContextFactory (Phase 2 — search-sync outbox events)
// instead of a raw db handle. The fake db behaves identically; it's just one level deeper.
function makeFakeCtxFactory(db: ReturnType<typeof makeFakeDb>['db']): { create: () => unknown } {
  return {
    create: () => ({
      db: { raw: db },
      events: { publish: vi.fn().mockResolvedValue(undefined) },
    }),
  };
}

async function buildApp(db: ReturnType<typeof makeFakeDb>['db']): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; message: string };
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    return reply.code(500).send({ error: 'Internal server error' });
  });
  await userRoutes(app, makeFakeCtxFactory(db) as never);
  return app;
}

describe('ES-21 — users.ts route permission guards (C3)', () => {
  it.each([
    ['GET', '/users'],
    ['GET', '/users/2'],
    ['POST', '/users'],
    ['PUT', '/users/2'],
    ['DELETE', '/users/2'],
    ['POST', '/users/2/lock'],
    ['POST', '/users/2/unlock'],
    ['PUT', '/users/2/branches'],
    ['POST', '/users/2/reset-password'],
  ])('%s %s without the matching permission → 403', async (method, url) => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1, permissions: [] });

    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /users with no Authorization header → 401', async () => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);

    const res = await app.inject({ method: 'GET', url: '/users' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /users/:id/reset-password with USER_MANAGE but the wrong current password → 422', async () => {
    // Not 401 — that status collides with the frontend apiClient's token-refresh interceptor,
    // which treats any 401 on an authenticated request as "session expired" and transparently
    // retries after refreshing tokens, silently swallowing this specific business-logic error.
    // BusinessError's default (422) matches every other validation/business-rule failure.
    mockArgon2Verify.mockResolvedValueOnce(false); // caller's own current password check fails
    const { db, store } = makeFakeDb();
    store.users.push({ id: 1, tenantId: 1, passwordHash: '$argon2id$caller-hash' });
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1, permissions: ['USER_MANAGE'] });

    const res = await app.inject({
      method: 'POST',
      url: '/users/2/reset-password',
      headers: { Authorization: `Bearer ${token}` },
      payload: { currentPassword: 'WrongPassword!23', newPassword: 'BrandNewPassword!23' },
    });

    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('POST /users/:id/reset-password without a currentPassword field → 422 (schema validation)', async () => {
    const { db, store } = makeFakeDb();
    store.users.push({ id: 1, tenantId: 1, passwordHash: '$argon2id$caller-hash' });
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1, permissions: ['USER_MANAGE'] });

    const res = await app.inject({
      method: 'POST',
      url: '/users/2/reset-password',
      headers: { Authorization: `Bearer ${token}` },
      payload: { newPassword: 'BrandNewPassword!23' },
    });

    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('POST /users/:id/reset-password with the correct current password → 200', async () => {
    mockArgon2Verify.mockResolvedValueOnce(true); // caller's own current password check passes
    const { db, store } = makeFakeDb();
    store.users.push({ id: 1, tenantId: 1, passwordHash: '$argon2id$caller-hash' });
    store.users.push({ id: 2, tenantId: 1, passwordHash: '$argon2id$target-hash' });
    const app = await buildApp(db);
    const token = await tokenFor({ sub: '1', tenantId: 1, permissions: ['USER_MANAGE'] });

    const res = await app.inject({
      method: 'POST',
      url: '/users/2/reset-password',
      headers: { Authorization: `Bearer ${token}` },
      payload: { currentPassword: 'MyOwnCorrectPassword!23', newPassword: 'BrandNewPassword!23' },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST /users attempting to assign a role with a permission the caller does not hold → 403', async () => {
    const { db, store } = makeFakeDb();
    store.roles.push({ id: 10, tenantId: 1, name: 'ELEVATED_ROLE' });
    store.rolePermissions.push({ roleId: 10, permission: 'USER_MANAGE' });
    const app = await buildApp(db);
    // Caller only holds USER_CREATE — not USER_MANAGE, which the target role grants.
    const token = await tokenFor({ sub: '1', tenantId: 1, permissions: ['USER_CREATE'] });

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        email: 'newadmin@testco.com',
        password: 'BrandNewPassword!23',
        firstName: 'New',
        lastName: 'Admin',
        roleIds: [10],
      },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /users assigning a role whose permissions are a subset of the caller's own → 201", async () => {
    const { db, store } = makeFakeDb();
    store.roles.push({ id: 11, tenantId: 1, name: 'CASHIER' });
    store.rolePermissions.push({ roleId: 11, permission: 'INVOICE_VIEW' });
    const app = await buildApp(db);
    const token = await tokenFor({
      sub: '1',
      tenantId: 1,
      permissions: ['USER_CREATE', 'INVOICE_VIEW'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        email: 'newcashier@testco.com',
        password: 'BrandNewPassword!23',
        firstName: 'New',
        lastName: 'Cashier',
        roleIds: [11],
      },
    });

    expect(res.statusCode).toBe(201);
    await app.close();
  });
});
