/**
 * PG-002 — MFA-token cache goes through TenantScopedCache, not a raw ioredis key.
 *
 * Asserts the write (login.ts) and read (mfa.routes.ts) sides agree on a
 * tenant-namespaced Redis key (`tenant:{tenantId}:mfa:...`), so a login flow that
 * bypassed the sanctioned cache abstraction can't silently regress.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { importPKCS8, type KeyLike } from 'jose';
import { authenticator } from 'otplib';
import { decryptField } from '@erp/utils';
import type * as ErpTypes from '@erp/types';

const { mockArgon2Verify, mockArgon2Hash } = vi.hoisted(() => ({
  mockArgon2Verify: vi.fn<[], Promise<boolean>>().mockResolvedValue(true),
  mockArgon2Hash: vi.fn<[], Promise<string>>().mockResolvedValue('$argon2id$test-hash'),
}));

vi.mock('argon2', () => ({
  default: { hash: mockArgon2Hash, verify: mockArgon2Verify, argon2id: 0 },
}));

vi.mock('@erp/db', () => ({
  users: { __name: 'users' },
  userRoles: { __name: 'userRoles' },
  rolePermissions: { __name: 'rolePermissions' },
  roles: { __name: 'roles' },
  userBranches: { __name: 'userBranches' },
  refreshTokens: { __name: 'refreshTokens' },
  activeSessions: { __name: 'activeSessions' },
  blockedIps: { __name: 'blockedIps' },
  securityAuditLog: { __name: 'securityAuditLog' },
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  isNull: vi.fn(() => '__isNull__'),
  gt: vi.fn(() => '__gt__'),
  desc: vi.fn(() => '__desc__'),
  inArray: vi.fn(() => '__inArray__'),
  // TenantScopedCache is imported via '@erp/sdk', whose barrel pulls in modules
  // (e.g. tenantStatus.ts) that reference drizzle-orm's `sql` at import time.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

// See mfa.test.ts for why @erp/types needs this patch under vitest's alias resolution.
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: { ...actual.PERMISSIONS, IMPERSONATE_USER: 'IMPERSONATE_USER', VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG' },
  };
});

import { users } from '@erp/db';
import { initializeJwt } from '../jwt.js';
import { loginRoute } from '../routes/login.js';
import { mfaVerifyRoute } from '../routes/mfa.routes.js';
import { MFAService } from '../domain/MFAService.js';

const TEST_ISSUER = 'erp-auth-service-mfa-cache-test';
const TEST_ACCESS_TTL = 900;
const ENCRYPTION_KEY = 'a'.repeat(64);

const TEST_CONFIG = {
  jwtIssuer: TEST_ISSUER,
  jwtAccessTokenTtl: TEST_ACCESS_TTL,
  jwtRefreshTokenTtlDays: 7,
  loginRateLimitMax: 100,
  loginRateLimitWindowMs: 300_000,
  accountLockoutAttempts: 999,
  accountLockoutDurationMs: 900_000,
  port: 3099,
  databaseUrl: 'postgres://test',
  redisUrl: 'redis://test',
  passwordResetTokenTtlMs: 3_600_000,
  smtpFromAddress: 'test@erp.local',
  jwtPrivateKey: '',
  jwtPublicKey: '',
  fieldEncryptionKey: ENCRYPTION_KEY,
};

function makeFakeDb() {
  const store = { users: [] as Record<string, unknown>[] };

  function selectResult(rows: Record<string, unknown>[]): unknown {
    return Object.assign(Promise.resolve(rows.slice()), {
      where: () =>
        Object.assign(Promise.resolve(rows.slice()), {
          limit: async (n: number) => rows.slice(0, n),
        }),
    });
  }

  const db = {
    select: () => ({ from: (table: unknown) => selectResult(table === users ? store.users : []) }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (table === users) store.users.forEach((row) => Object.assign(row, patch));
          return [];
        },
      }),
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        const row = { id: 1, ...val };
        return Object.assign(Promise.resolve([row]), { returning: async () => [row] });
      },
    }),
  };

  return { db, store };
}

// Same shape as ioredis's relevant subset — records every key TenantScopedCache
// namespaces so the test can assert on it directly.
function makeRedis() {
  const kv = new Map<string, string>();
  return {
    kv,
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      kv.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (kv.delete(key) ? 1 : 0)),
    incr: vi.fn(async (key: string) => {
      const next = parseInt(kv.get(key) ?? '0', 10) + 1;
      kv.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async (key: string) => (kv.has(key) ? 300 : -2)),
  };
}

let testPrivateKey: KeyLike;

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  testPrivateKey = await importPKCS8(privateKey, 'RS256');
  await initializeJwt({
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    issuer: TEST_ISSUER,
    accessTokenTtlSeconds: TEST_ACCESS_TTL,
  });
});

function baseUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    tenantId: 1,
    email: 'mfa-cache-user@testco.com',
    passwordHash: '$argon2id$fake',
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    totpSecret: null,
    totpEnabled: false,
    backupCodes: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildAppWithMfaEnabledUser(tenantId: number): Promise<{
  app: FastifyInstance;
  redis: ReturnType<typeof makeRedis>;
  rawSecret: string;
}> {
  const { db, store } = makeFakeDb();
  const mfaService = new MFAService(db as never, ENCRYPTION_KEY);

  store.users.push(baseUser({ tenantId }));
  await mfaService.enrollTOTP(1, tenantId);
  const rawSecret = decryptField((store.users[0] as { totpSecret: string }).totpSecret, ENCRYPTION_KEY);
  await mfaService.confirmEnrollment(1, authenticator.generate(rawSecret));

  const redis = makeRedis();
  const app = Fastify({ logger: false });
  await loginRoute(app, db as never, TEST_CONFIG as never, redis as never);
  await mfaVerifyRoute(app, db as never, TEST_CONFIG as never, redis as never);

  return { app, redis, rawSecret };
}

describe('PG-002 — MFA token cache is tenant-namespaced via TenantScopedCache', () => {
  it('login writes the MFA token under a tenant:{tenantId}:mfa: key, not a bare mfa: key', async () => {
    const { app, redis } = await buildAppWithMfaEnabledUser(7);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-cache-user@testco.com', password: 'Correct!', tenantId: 7 },
    });
    expect(loginRes.statusCode).toBe(200);

    expect(redis.setex).toHaveBeenCalledTimes(1);
    const [writtenKey] = redis.setex.mock.calls[0] as [string, number, string];
    expect(writtenKey).toMatch(/^tenant:7:mfa:/);
    expect(writtenKey).not.toMatch(/^mfa:/);

    await app.close();
  });

  it('a full login → verify round trip succeeds and reads back the same tenant-scoped key that was written', async () => {
    const { app, redis, rawSecret } = await buildAppWithMfaEnabledUser(7);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-cache-user@testco.com', password: 'Correct!', tenantId: 7 },
    });
    const { mfaToken } = (JSON.parse(loginRes.body) as { data: { mfaToken: string } }).data;

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: authenticator.generate(rawSecret) },
    });

    expect(verifyRes.statusCode).toBe(200);
    const body = JSON.parse(verifyRes.body) as { data: { accessToken: string } };
    expect(body.data.accessToken).toBeTruthy();

    const [writtenKey] = redis.setex.mock.calls[0] as [string, number, string];
    const [readKey] = redis.get.mock.calls[0] as [string];
    expect(readKey).toBe(writtenKey);

    await app.close();
  });

  it('a token for tenant A cannot be replayed against tenant B — the tenant prefix is part of the key', async () => {
    const { app: appA } = await buildAppWithMfaEnabledUser(1);
    const { app: appB } = await buildAppWithMfaEnabledUser(2);

    const loginRes = await appA.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-cache-user@testco.com', password: 'Correct!', tenantId: 1 },
    });
    const { mfaToken } = (JSON.parse(loginRes.body) as { data: { mfaToken: string } }).data;

    // Same opaque token replayed against tenant B's app/redis instance — must not resolve
    // to a payload, since tenant B's redis never had this key written.
    const crossTenantRes = await appB.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: '000000' },
    });
    expect(crossTenantRes.statusCode).toBe(401);

    await appA.close();
    await appB.close();
  });
});
