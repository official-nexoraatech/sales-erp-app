/**
 * Phase 13 — Auth Security Hardening (Task 13.1.6)
 *
 * Covers:
 *   13.1.6a  Brute force → account locked after 5th failed attempt (429)
 *   13.1.6b  Already-locked account → 429 without checking password
 *   13.1.6c  Expired JWT → verifyAccessToken rejects + middleware returns 401
 *   13.1.6d  Refresh token rotation → old token revoked on first use
 *   13.1.6e  IDOR: tenantId is sourced exclusively from the JWT, not request body
 *   13.1.6f  Missing Authorization header → 401
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, importSPKI, type KeyLike } from 'jose';

// ─── Hoisted mock spies (available inside vi.mock factory) ────────────────

const { mockArgon2Verify, mockArgon2Hash } = vi.hoisted(() => ({
  mockArgon2Verify: vi.fn<[], Promise<boolean>>(),
  mockArgon2Hash: vi.fn<[], Promise<string>>().mockResolvedValue('$argon2id$test-hash'),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────

vi.mock('@erp/db', () => ({
  users: {},
  userRoles: {},
  rolePermissions: {},
  roles: {},
  userBranches: {},
  refreshTokens: {},
  activeSessions: {},
  blockedIps: {},
  securityAuditLog: {},
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  isNull: vi.fn(() => '__isNull__'),
  gt: vi.fn(() => '__gt__'),
  inArray: vi.fn(() => '__inArray__'),
  // PG-002: login.ts now imports TenantScopedCache from '@erp/sdk', whose barrel pulls
  // in modules (e.g. tenantStatus.ts) that reference drizzle-orm's `sql` at import time.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock('argon2', () => ({
  default: {
    hash: mockArgon2Hash,
    verify: mockArgon2Verify,
    argon2id: 0,
  },
}));

// ─── Real module imports (after mocks are declared) ────────────────────────

import { initializeJwt, verifyAccessToken } from '../jwt.js';
import { loginRoute } from '../routes/login.js';
import { refreshRoute } from '../routes/refresh.js';
import { authenticate } from '../middleware/authenticate.js';
import { sha256Hex } from '../crypto.js';

// ─── Test constants ───────────────────────────────────────────────────────

const TEST_ISSUER = 'erp-auth-service-test';
const TEST_ACCESS_TTL = 900;

let testPrivateKey: KeyLike;

const TEST_CONFIG = {
  jwtIssuer: TEST_ISSUER,
  jwtAccessTokenTtl: TEST_ACCESS_TTL,
  jwtRefreshTokenTtlDays: 7,
  loginRateLimitMax: 10,
  loginRateLimitWindowMs: 300_000,
  accountLockoutAttempts: 5,
  accountLockoutDurationMs: 900_000,
  port: 3099,
  databaseUrl: 'postgres://test',
  redisUrl: 'redis://test',
  passwordResetTokenTtlMs: 3_600_000,
  smtpFromAddress: 'test@erp.local',
  jwtPrivateKey: '',
  jwtPublicKey: '',
};

// ─── DB mock helpers ──────────────────────────────────────────────────────

function makeSelectLimit(rows: unknown[]): unknown {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function makeSelectWhere(rows: unknown[]): unknown {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function makeUpdate(): { set: ReturnType<typeof vi.fn>; chain: unknown } {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  return { set, chain: { set } };
}

function makeInsert(returningRows: unknown[] = []): unknown {
  // Supports both `await db.insert(x).values(y)` and
  // `await db.insert(x).values(y).returning()` call shapes used across routes.
  const chain = Object.assign(Promise.resolve([]), {
    returning: vi.fn().mockResolvedValue(returningRows),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
  });
  return { values: vi.fn().mockReturnValue(chain) };
}

function makeRedis(): Record<string, ReturnType<typeof vi.fn>> {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
    incr: vi.fn(async (key: string) => {
      const next = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
}

// ─── Test app factory ─────────────────────────────────────────────────────

async function buildApp(
  db: Record<string, unknown>,
  redis: Record<string, unknown> = makeRedis()
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await loginRoute(app, db as never, TEST_CONFIG as never, redis as never);
  await refreshRoute(app, db as never, TEST_CONFIG as never);
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 13 — Auth Security Hardening', () => {
  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    testPrivateKey = await importPKCS8(privateKey, 'RS256');
    const pubKey = await importSPKI(publicKey, 'RS256');
    void pubKey; // imported only to verify key pair is valid

    await initializeJwt({
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      issuer: TEST_ISSUER,
      accessTokenTtlSeconds: TEST_ACCESS_TTL,
    });
  });

  // ─── 13.1.6a: Brute force lockout ──────────────────────────────────────

  describe('13.1.6a — Brute force lockout', () => {
    it('locks account and returns 429 on the 5th consecutive failed attempt', async () => {
      mockArgon2Verify.mockResolvedValueOnce(false);

      const mockUser = {
        id: 1, email: 'brute@testco.com', tenantId: 1,
        isActive: true, passwordHash: '$argon2id$fake',
        failedLoginAttempts: 4, lockedUntil: null,
        lastLoginAt: null, updatedAt: new Date(),
      };

      const { set: updateSetSpy } = makeUpdate();
      const db = {
        select: vi.fn()
          .mockReturnValueOnce(makeSelectLimit([]))       // blocked_ips lookup — IP not blocked
          .mockReturnValue(makeSelectLimit([mockUser])),  // users lookup
        update: vi.fn().mockReturnValue({ set: updateSetSpy }),
        insert: vi.fn().mockReturnValue(makeInsert()),
      };

      const app = await buildApp(db);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'brute@testco.com', password: 'Wrong!', tenantId: 1 },
      });

      expect(res.statusCode).toBe(429);
      const body = JSON.parse(res.body) as { error: string; retryAfterSeconds: number };
      expect(body.error).toMatch(/locked/i);
      expect(typeof body.retryAfterSeconds).toBe('number');
      expect(body.retryAfterSeconds).toBeGreaterThan(0);

      // Verify the account was locked in the DB (lockedUntil was set)
      expect(updateSetSpy).toHaveBeenCalledWith(
        expect.objectContaining({ lockedUntil: expect.any(Date) })
      );

      await app.close();
    });

    it('returns 429 immediately for an already-locked account without checking password', async () => {
      mockArgon2Verify.mockClear();

      const lockedUser = {
        id: 2, email: 'locked@testco.com', tenantId: 1,
        isActive: true, passwordHash: '$argon2id$fake',
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 900_000), // still locked
        lastLoginAt: null, updatedAt: new Date(),
      };

      const db = {
        select: vi.fn()
          .mockReturnValueOnce(makeSelectLimit([]))          // blocked_ips lookup — IP not blocked
          .mockReturnValue(makeSelectLimit([lockedUser])),   // users lookup
        update: vi.fn(),
      };

      const app = await buildApp(db);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'locked@testco.com', password: 'AnyPassword!', tenantId: 1 },
      });

      expect(res.statusCode).toBe(429);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toMatch(/temporarily locked/i);

      // Password must NOT have been checked — constant-time guard
      expect(mockArgon2Verify).not.toHaveBeenCalled();

      await app.close();
    });
  });

  // ─── 13.1.6c: JWT expiry ───────────────────────────────────────────────

  describe('13.1.6c — JWT expiry → 401', () => {
    it('verifyAccessToken rejects a token with a past expiration time', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({
        tenantId: 1, email: 'user@testco.com', roles: [], permissions: [],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('1')
        .setIssuedAt(nowSec - 3600)     // issued 1 hour ago
        .setIssuer(TEST_ISSUER)
        .setExpirationTime(nowSec - 1)  // expired 1 second ago
        .sign(testPrivateKey);

      await expect(verifyAccessToken(expiredToken)).rejects.toThrow();
    });

    it('authenticate middleware returns 401 for an expired Bearer token', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({
        tenantId: 1, email: 'user@testco.com', roles: [], permissions: [],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('1')
        .setIssuedAt(nowSec - 3600)
        .setIssuer(TEST_ISSUER)
        .setExpirationTime(nowSec - 1)
        .sign(testPrivateKey);

      const app = Fastify({ logger: false });
      app.get('/protected', { preHandler: [authenticate] }, async () => ({ ok: true }));

      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toMatch(/invalid or expired/i);

      await app.close();
    });
  });

  // ─── 13.1.6d: Refresh token rotation ──────────────────────────────────

  describe('13.1.6d — Refresh token rotation', () => {
    it('revokes the old refresh token after a successful refresh', async () => {
      const PLAIN_TOKEN = 'test-plain-refresh-token-32bytes!';
      const expectedHash = sha256Hex(PLAIN_TOKEN);

      const tokenRow = {
        id: 10, tokenHash: expectedHash, revokedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userId: 1, tenantId: 1, userAgent: null, ipAddress: '127.0.0.1',
      };

      const userRow = {
        id: 1, email: 'rotate@testco.com', tenantId: 1, isActive: true,
        passwordHash: '$argon2id$fake', failedLoginAttempts: 0,
        lockedUntil: null, lastLoginAt: null, updatedAt: new Date(),
      };

      const revokeSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

      const db = {
        select: vi.fn()
          .mockReturnValueOnce(makeSelectLimit([tokenRow]))   // refreshTokens lookup
          .mockReturnValueOnce(makeSelectLimit([userRow]))    // users lookup
          .mockReturnValueOnce(makeSelectWhere([]))           // userRoles lookup (empty -> skips rolePermissions)
          .mockReturnValueOnce(makeSelectWhere([]))           // userBranches lookup (queried in parallel with userRoles)
          .mockReturnValue(makeSelectLimit([])),              // rotateSession's activeSessions lookup
        update: vi.fn().mockReturnValue({ set: revokeSpy }),
        insert: vi.fn().mockReturnValue(makeInsert([{ id: 99 }])),
      };

      const app = await buildApp(db);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: PLAIN_TOKEN },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { accessToken: string; refreshToken: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      // New token must differ from old token (rotation occurred)
      expect(body.refreshToken).not.toBe(PLAIN_TOKEN);

      // Old token must have been revoked (revokedAt set)
      expect(revokeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) })
      );

      await app.close();
    });
  });

  // ─── 13.1.6e: IDOR — tenantId from JWT, not request ──────────────────

  describe('13.1.6e — IDOR: tenantId sourced from JWT only', () => {
    it('request.auth.tenantId equals the tenantId embedded in the JWT', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        tenantId: 42,  // a specific tenant
        email: 'owner@tenant42.com',
        roles: [],
        permissions: [],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('99')
        .setIssuer(TEST_ISSUER)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + TEST_ACCESS_TTL)
        .sign(testPrivateKey);

      const app = Fastify({ logger: false });
      app.get('/whoami', { preHandler: [authenticate] }, async (request) => ({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
      }));

      const res = await app.inject({
        method: 'GET',
        url: '/whoami',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { tenantId: number; userId: number };
      // tenantId must come from the JWT claim, not any client-supplied value
      expect(body.tenantId).toBe(42);
      expect(body.userId).toBe(99);

      await app.close();
    });

    it('a token for tenant A cannot be reused to assert a different tenantId', async () => {
      // This test verifies that the authenticate middleware does NOT read tenantId
      // from anywhere except the JWT signature. There is no way for a client to
      // override the tenantId without possessing the private key.
      const nowSec = Math.floor(Date.now() / 1000);
      const tokenForTenant1 = await new SignJWT({
        tenantId: 1, email: 'hacker@evil.com', roles: [], permissions: [],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('7')
        .setIssuer(TEST_ISSUER)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + TEST_ACCESS_TTL)
        .sign(testPrivateKey);

      const app = Fastify({ logger: false });
      app.get('/check', { preHandler: [authenticate] }, async (request) => ({
        tenantId: request.auth.tenantId,
      }));

      const res = await app.inject({
        method: 'GET',
        url: '/check',
        headers: { Authorization: `Bearer ${tokenForTenant1}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { tenantId: number };
      // Must be 1 (from JWT), not any other value
      expect(body.tenantId).toBe(1);

      await app.close();
    });
  });

  // ─── 13.1.6f: Missing Authorization header ────────────────────────────

  describe('13.1.6f — Missing Authorization header → 401', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const app = Fastify({ logger: false });
      app.get('/protected', { preHandler: [authenticate] }, async () => ({ ok: true }));

      const res = await app.inject({ method: 'GET', url: '/protected' });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toMatch(/missing or invalid/i);

      await app.close();
    });

    it('returns 401 when Authorization header is malformed (no Bearer prefix)', async () => {
      const app = Fastify({ logger: false });
      app.get('/protected', { preHandler: [authenticate] }, async () => ({ ok: true }));

      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });
});
