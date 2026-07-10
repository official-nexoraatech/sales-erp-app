/**
 * ES-19 — Enterprise Security: 2FA & Advanced Auth
 *
 * Covers the 9 required scenarios:
 *   1. Enroll 2FA → TOTP secret stored encrypted (not plaintext)
 *   2. Confirm enrollment with valid TOTP code → users.totp_enabled = true
 *   3. Login with 2FA enabled → returns { requiresMFA: true, mfaToken }
 *   4. /auth/mfa/verify with correct TOTP → returns accessToken
 *   5. /auth/mfa/verify with incorrect TOTP → 401
 *   6. /auth/mfa/verify with already-used mfaToken → 401 (single-use)
 *   7. Use backup code → succeeds; that code no longer works on second use
 *   8. Impersonation → security_audit_log has IMPERSONATION_START row
 *   9. 5 failed login attempts from same IP → IP blocked for 1 hour → 6th attempt is 429
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { authenticator } from 'otplib';
import { decryptField } from '@erp/utils';
import { PERMISSIONS } from '@erp/types';
import type * as ErpTypes from '@erp/types';

const { mockArgon2Verify, mockArgon2Hash } = vi.hoisted(() => ({
  mockArgon2Verify: vi.fn<[], Promise<boolean>>().mockResolvedValue(false),
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
  // PG-002: login/mfa routes now import TenantScopedCache from '@erp/sdk', whose barrel
  // pulls in modules (e.g. tenantStatus.ts) that reference drizzle-orm's `sql` at import time.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

// vitest's alias-based resolution of '@erp/types' in this workspace intermittently
// yields a stale/truncated PERMISSIONS object (missing constants added by later phases,
// e.g. IMPERSONATE_USER) even though `tsc`/`tsx`/the built dist all resolve it correctly —
// a vitest/vite dependency-graph quirk, not a defect in permissions.ts. Patch just the
// constants this suite needs on top of whatever the real module provides.
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      IMPERSONATE_USER: 'IMPERSONATE_USER',
      VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
    },
  };
});

import { users, userRoles, rolePermissions, roles, refreshTokens, activeSessions, blockedIps, securityAuditLog } from '@erp/db';
import { initializeJwt } from '../jwt.js';
import { loginRoute } from '../routes/login.js';
import { mfaVerifyRoute, mfaManagementRoutes } from '../routes/mfa.routes.js';
import { impersonateRoutes } from '../routes/impersonate.routes.js';
import { authenticate } from '../middleware/authenticate.js';
import { MFAService } from '../domain/MFAService.js';

const TEST_ISSUER = 'erp-auth-service-mfa-test';
const TEST_ACCESS_TTL = 900;
const ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex

const TEST_CONFIG = {
  jwtIssuer: TEST_ISSUER,
  jwtAccessTokenTtl: TEST_ACCESS_TTL,
  jwtRefreshTokenTtlDays: 7,
  loginRateLimitMax: 100,
  loginRateLimitWindowMs: 300_000,
  accountLockoutAttempts: 999, // keep account-level lockout out of the way of IP-level tests
  accountLockoutDurationMs: 900_000,
  ipLoginFailThreshold: 5,
  ipLoginFailWindowSeconds: 600,
  ipBlockDurationMs: 3_600_000,
  port: 3099,
  databaseUrl: 'postgres://test',
  redisUrl: 'redis://test',
  passwordResetTokenTtlMs: 3_600_000,
  smtpFromAddress: 'test@erp.local',
  jwtPrivateKey: '',
  jwtPublicKey: '',
  fieldEncryptionKey: ENCRYPTION_KEY,
};

// ─── In-memory fake DB — a shared mutable store per table, filters ignored ──
// (mirrors the eq/and mocks above: every predicate is a no-op stand-in, so
// each store is expected to hold only the row(s) relevant to the test)

function makeFakeDb() {
  const store = {
    users: [] as Record<string, unknown>[],
    userRoles: [] as Record<string, unknown>[],
    rolePermissions: [] as Record<string, unknown>[],
    roles: [] as Record<string, unknown>[],
    refreshTokens: [] as Record<string, unknown>[],
    activeSessions: [] as Record<string, unknown>[],
    blockedIps: [] as Record<string, unknown>[],
    securityAuditLog: [] as Record<string, unknown>[],
  };

  function rowsFor(table: unknown): Record<string, unknown>[] {
    if (table === users) return store.users;
    if (table === userRoles) return store.userRoles;
    if (table === roles) return store.roles;
    if (table === rolePermissions) return store.rolePermissions;
    if (table === refreshTokens) return store.refreshTokens;
    if (table === activeSessions) return store.activeSessions;
    if (table === blockedIps) return store.blockedIps;
    if (table === securityAuditLog) return store.securityAuditLog;
    return [];
  }

  function selectResult(rows: Record<string, unknown>[]): unknown {
    const base = Promise.resolve(rows.slice());
    return Object.assign(base, {
      where: (_cond?: unknown) =>
        Object.assign(Promise.resolve(rows.slice()), {
          limit: async (n: number) => rows.slice(0, n),
          orderBy: () =>
            Object.assign(Promise.resolve(rows.slice()), {
              limit: (n: number) =>
                Object.assign(Promise.resolve(rows.slice(0, n)), {
                  offset: async () => rows.slice(0, n),
                }),
            }),
        }),
    });
  }

  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => selectResult(rowsFor(table)),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (_cond?: unknown) => {
          rowsFor(table).forEach((row) => Object.assign(row, patch));
          return [];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        const rows = rowsFor(table);
        const row = { id: rows.length + 1, ...val };
        rows.push(row);
        const p = Promise.resolve([row]);
        return Object.assign(p, {
          returning: async () => [row],
          onConflictDoUpdate: async (opts: { set: Record<string, unknown> }) => {
            Object.assign(row, opts.set);
            return [row];
          },
        });
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        rowsFor(table).length = 0;
        return [];
      },
    }),
  };

  return { db, store };
}

function makeRedis(): Record<string, ReturnType<typeof vi.fn>> {
  const kv = new Map<string, string>();
  return {
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
    email: 'mfa-user@testco.com',
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

describe('ES-19 — 2FA & Advanced Auth', () => {
  // ─── 1 & 2: Enrollment + confirmation ─────────────────────────────────────

  it('1. enrollTOTP stores an encrypted secret — never plaintext', async () => {
    const { db, store } = makeFakeDb();
    store.users.push(baseUser());

    const generateSecretSpy = vi.spyOn(authenticator, 'generateSecret');
    const mfaService = new MFAService(db as never, ENCRYPTION_KEY);

    const result = await mfaService.enrollTOTP(1, 1);
    const rawSecret = generateSecretSpy.mock.results[0]?.value as string;

    expect(result.backupCodes).toHaveLength(10);
    expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const storedUser = store.users[0] as { totpSecret: string; totpEnabled: boolean; backupCodes: string[] };
    expect(storedUser.totpSecret).not.toBe(rawSecret);
    expect(decryptField(storedUser.totpSecret, ENCRYPTION_KEY)).toBe(rawSecret);
    expect(storedUser.totpEnabled).toBe(false); // not enabled until confirmed
    expect(storedUser.backupCodes).not.toEqual(result.backupCodes); // stored as hashes, not plaintext

    generateSecretSpy.mockRestore();
  });

  it('2. confirmEnrollment with a valid TOTP code sets totpEnabled = true', async () => {
    const { db, store } = makeFakeDb();
    store.users.push(baseUser());

    const mfaService = new MFAService(db as never, ENCRYPTION_KEY);
    await mfaService.enrollTOTP(1, 1);

    const storedUser = store.users[0] as { totpSecret: string };
    const rawSecret = decryptField(storedUser.totpSecret, ENCRYPTION_KEY);
    const validCode = authenticator.generate(rawSecret);

    await mfaService.confirmEnrollment(1, validCode);

    expect((store.users[0] as { totpEnabled: boolean }).totpEnabled).toBe(true);
  });

  it('2b. confirmEnrollment rejects an invalid TOTP code', async () => {
    const { db, store } = makeFakeDb();
    store.users.push(baseUser());

    const mfaService = new MFAService(db as never, ENCRYPTION_KEY);
    await mfaService.enrollTOTP(1, 1);

    await expect(mfaService.confirmEnrollment(1, '000000')).rejects.toThrow();
    expect((store.users[0] as { totpEnabled: boolean }).totpEnabled).toBe(false);
  });

  // ─── 3, 4, 5, 6: Login → MFA challenge → verify ───────────────────────────

  async function buildAppWithMfaEnabledUser(): Promise<{
    app: FastifyInstance;
    redis: ReturnType<typeof makeRedis>;
    store: ReturnType<typeof makeFakeDb>['store'];
    rawSecret: string;
  }> {
    const { db, store } = makeFakeDb();
    const mfaService = new MFAService(db as never, ENCRYPTION_KEY);

    store.users.push(baseUser());
    await mfaService.enrollTOTP(1, 1);
    const rawSecret = decryptField((store.users[0] as { totpSecret: string }).totpSecret, ENCRYPTION_KEY);
    const validCode = authenticator.generate(rawSecret);
    await mfaService.confirmEnrollment(1, validCode);

    mockArgon2Verify.mockResolvedValue(true); // password always "correct" in these tests

    const redis = makeRedis();
    const app = Fastify({ logger: false });
    await loginRoute(app, db as never, TEST_CONFIG as never, redis as never);
    await mfaVerifyRoute(app, db as never, TEST_CONFIG as never, redis as never);

    return { app, redis, store, rawSecret };
  }

  it('3. login with 2FA enabled returns { requiresMFA: true, mfaToken }', async () => {
    const { app } = await buildAppWithMfaEnabledUser();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-user@testco.com', password: 'Correct!', tenantId: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { requiresMFA: boolean; mfaToken: string } };
    expect(body.data.requiresMFA).toBe(true);
    expect(typeof body.data.mfaToken).toBe('string');
    expect(body.data.mfaToken.length).toBeGreaterThan(0);

    await app.close();
  });

  it('4. /auth/mfa/verify with the correct TOTP code returns an accessToken', async () => {
    const { app, rawSecret } = await buildAppWithMfaEnabledUser();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-user@testco.com', password: 'Correct!', tenantId: 1 },
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

    await app.close();
  });

  it('5. /auth/mfa/verify with an incorrect TOTP code returns 401', async () => {
    const { app } = await buildAppWithMfaEnabledUser();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-user@testco.com', password: 'Correct!', tenantId: 1 },
    });
    const { mfaToken } = (JSON.parse(loginRes.body) as { data: { mfaToken: string } }).data;

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: '000000' },
    });

    expect(verifyRes.statusCode).toBe(401);

    await app.close();
  });

  it('6. /auth/mfa/verify rejects an already-used mfaToken (single-use)', async () => {
    const { app, rawSecret } = await buildAppWithMfaEnabledUser();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa-user@testco.com', password: 'Correct!', tenantId: 1 },
    });
    const { mfaToken } = (JSON.parse(loginRes.body) as { data: { mfaToken: string } }).data;
    const code = authenticator.generate(rawSecret);

    const firstAttempt = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfaToken, code } });
    expect(firstAttempt.statusCode).toBe(200);

    const secondAttempt = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfaToken, code } });
    expect(secondAttempt.statusCode).toBe(401);

    await app.close();
  });

  // ─── 7: Backup codes ───────────────────────────────────────────────────────

  it('7. a backup code works once, then fails on a second use', async () => {
    const { db, store } = makeFakeDb();
    store.users.push(baseUser());

    const mfaService = new MFAService(db as never, ENCRYPTION_KEY);
    const { backupCodes } = await mfaService.enrollTOTP(1, 1);
    const code = backupCodes[0] as string;

    const firstUse = await mfaService.useBackupCode(1, code);
    expect(firstUse).toBe(true);

    const secondUse = await mfaService.useBackupCode(1, code);
    expect(secondUse).toBe(false);
  });

  // ─── 8: Impersonation audit trail ──────────────────────────────────────────

  it('8. impersonation writes an IMPERSONATION_START row to security_audit_log', async () => {
    const { db, store } = makeFakeDb();
    store.users.push(baseUser({ id: 2, email: 'target@testco.com' }));

    const app = Fastify({ logger: false });
    app.addHook('preHandler', authenticate);
    await impersonateRoutes(app, db as never);

    const nowSec = Math.floor(Date.now() / 1000);
    const adminToken = await new SignJWT({
      tenantId: 1,
      email: 'admin@testco.com',
      roles: ['SUPER_ADMIN'],
      permissions: [PERMISSIONS.IMPERSONATE_USER],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('10')
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + TEST_ACCESS_TTL)
      .sign(testPrivateKey);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/impersonate',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { targetUserId: 2, reason: 'Investigating support ticket #123' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { accessToken: string } };
    expect(body.data.accessToken).toBeTruthy();

    expect(store.securityAuditLog).toHaveLength(1);
    const auditRow = store.securityAuditLog[0] as { action: string; targetUserId: number; actorId: number };
    expect(auditRow.action).toBe('IMPERSONATION_START');
    expect(auditRow.targetUserId).toBe(2);
    expect(auditRow.actorId).toBe(10);

    await app.close();
  });

  // ─── 9: Suspicious login — IP blocking ────────────────────────────────────

  it('9. 5 failed logins from the same IP block the IP; the 6th attempt is 429', async () => {
    const { db } = makeFakeDb();
    mockArgon2Verify.mockResolvedValue(false);

    const redis = makeRedis();
    const app = Fastify({ logger: false });
    await loginRoute(app, db as never, TEST_CONFIG as never, redis as never);

    const attempt = (email: string): Promise<{ statusCode: number; body: string }> =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'WrongPassword!', tenantId: 1 },
      });

    for (let i = 0; i < 5; i++) {
      const res = await attempt(`nonexistent-${i}@testco.com`);
      expect(res.statusCode).toBe(401);
    }

    const sixthRes = await attempt('nonexistent-6@testco.com');
    expect(sixthRes.statusCode).toBe(429);
    const body = JSON.parse(sixthRes.body) as { error: string; retryAfterSeconds: number };
    expect(body.error).toMatch(/too many failed login attempts/i);
    expect(body.retryAfterSeconds).toBeGreaterThan(0);

    await app.close();
  });

  // ─── ES-21 — 10: Backup-codes regeneration moved to POST body (H12) ───────

  describe('ES-21 — 10. backup-codes regeneration (H12)', () => {
    async function buildManagementApp(): Promise<{
      app: FastifyInstance;
      token: string;
      rawSecret: string;
    }> {
      const { db, store } = makeFakeDb();
      store.users.push(baseUser());
      const mfaService = new MFAService(db as never, ENCRYPTION_KEY);
      await mfaService.enrollTOTP(1, 1);
      const rawSecret = decryptField((store.users[0] as { totpSecret: string }).totpSecret, ENCRYPTION_KEY);
      await mfaService.confirmEnrollment(1, authenticator.generate(rawSecret));

      const app = Fastify({ logger: false });
      app.addHook('preHandler', authenticate);
      await mfaManagementRoutes(app, db as never, TEST_CONFIG as never);

      const nowSec = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ tenantId: 1, email: 'mfa-user@testco.com', roles: [], permissions: [] })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('1')
        .setIssuer(TEST_ISSUER)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + TEST_ACCESS_TTL)
        .sign(testPrivateKey);

      return { app, token, rawSecret };
    }

    it('POST /mfa/backup-codes/regenerate with totpCode in the body succeeds', async () => {
      const { app, token, rawSecret } = await buildManagementApp();

      const res = await app.inject({
        method: 'POST',
        url: '/mfa/backup-codes/regenerate',
        headers: { Authorization: `Bearer ${token}` },
        payload: { totpCode: authenticator.generate(rawSecret) },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { data: { backupCodes: string[] } };
      expect(body.data.backupCodes).toHaveLength(10);

      await app.close();
    });

    it('the old GET route with a ?code= query param no longer exists', async () => {
      const { app, token } = await buildManagementApp();

      const res = await app.inject({
        method: 'GET',
        url: '/mfa/backup-codes?code=123456',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);

      await app.close();
    });

    it('rejects the request when totpCode is missing from the body', async () => {
      const { app, token } = await buildManagementApp();

      const res = await app.inject({
        method: 'POST',
        url: '/mfa/backup-codes/regenerate',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });
  });

  // ─── ES-21 — 11: /auth/mfa/verify per-token attempt cap (M17) ─────────────

  describe('ES-21 — 11. MFA verify per-token attempt cap (M17)', () => {
    it('the 6th wrong attempt against the same mfaToken invalidates it — even the correct code then fails', async () => {
      const { app, rawSecret } = await buildAppWithMfaEnabledUser();

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'mfa-user@testco.com', password: 'Correct!', tenantId: 1 },
      });
      const { mfaToken } = (JSON.parse(loginRes.body) as { data: { mfaToken: string } }).data;

      for (let i = 0; i < 5; i++) {
        const res = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfaToken, code: '000000' } });
        expect(res.statusCode).toBe(401);
      }

      const finalRes = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        payload: { mfaToken, code: authenticator.generate(rawSecret) },
      });
      expect(finalRes.statusCode).toBe(401);
      const body = JSON.parse(finalRes.body) as { error: string };
      expect(body.error).toMatch(/invalid or expired/i);

      await app.close();
    });

    it('a mistyped code does not immediately burn the token — a correct retry within the cap still succeeds', async () => {
      const { app, rawSecret } = await buildAppWithMfaEnabledUser();

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'mfa-user@testco.com', password: 'Correct!', tenantId: 1 },
      });
      const { mfaToken } = (JSON.parse(loginRes.body) as { data: { mfaToken: string } }).data;

      const wrongRes = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfaToken, code: '000000' } });
      expect(wrongRes.statusCode).toBe(401);

      const rightRes = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        payload: { mfaToken, code: authenticator.generate(rawSecret) },
      });
      expect(rightRes.statusCode).toBe(200);

      await app.close();
    });
  });
});
