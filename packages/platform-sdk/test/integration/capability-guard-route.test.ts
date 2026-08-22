// Proves the full preHandler chain (authenticate -> requireCapability -> requirePermission)
// end-to-end via a throwaway, never-deployed test route, mirroring
// apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts's exact skeleton (RSA
// keypair + signToken + buildApp + app.inject). This route exists only inside this test
// file — see 06-service-enforcement.md §3.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { ErpDatabase } from '@erp/db';
import type Redis from 'ioredis';
import { PERMISSIONS } from '@erp/types';

// Per-tenant, per-flag state the mocked PlatformFeatureFlags reads from — lets each test
// case control exactly what a given tenant's capability resolves to, including simulating
// a resolution failure ('throw'), without a real DB/Redis.
type FlagState = Record<number, Record<string, boolean | 'throw'>>;
let flagState: FlagState = {};

vi.mock('../../src/feature-flags.js', () => ({
  PlatformFeatureFlags: vi
    .fn()
    .mockImplementation((_db: unknown, _cache: unknown, tenantId: number) => ({
      isEnabled: vi.fn(async (flagKey: string) => {
        const value = flagState[tenantId]?.[flagKey];
        if (value === 'throw') throw new Error('Simulated DB/Redis failure');
        return value ?? false;
      }),
    })),
}));

const { requireCapability } = await import('../../src/capability-guard.js');
const { verifyAccessToken, checkPermission } = await import('../../src/auth.js');

const FAKE_DB = {} as ErpDatabase;
const FAKE_REDIS = {} as Redis;

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

// Mirrors every real service's own middleware/authenticate.ts (01-current-code-evidence.md §1).
async function testAuthenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
    return;
  }
  try {
    (request as FastifyRequest & { auth?: unknown }).auth = await verifyAccessToken(
      header.slice(7)
    );
  } catch {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
  }
}

// Mirrors every real service's own middleware/authorize.ts (01-current-code-evidence.md §1) —
// direct reply, never throws, exact FORBIDDEN contract this phase must not touch or rename.
function testRequirePermission(permission: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    const result = checkPermission(auth, permission);
    if (result === 'unauthenticated') {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
      return;
    }
    if (result === 'forbidden') {
      await reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${permission}` } });
    }
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get(
    '/__test/capability-check',
    { preHandler: [testAuthenticate, requireCapability('HR_PAYROLL', FAKE_DB, FAKE_REDIS)] },
    async () => ({ ok: true })
  );

  app.get(
    '/__test/capability-and-permission-check',
    {
      preHandler: [
        testAuthenticate,
        requireCapability('HR_PAYROLL', FAKE_DB, FAKE_REDIS),
        testRequirePermission(PERMISSIONS.PAYROLL_PROCESS),
      ],
    },
    async () => ({ ok: true })
  );

  return app;
}

const TENANT_A = 1;
const TENANT_B = 2;

describe('capability-guard route-level (throwaway test route)', () => {
  beforeEach(() => {
    flagState = {};
  });

  it('1. capability enabled + permission granted -> 200', async () => {
    flagState[TENANT_A] = { 'hr.payroll.enabled': true };
    const app = await buildApp();
    const token = await signToken({
      sub: '1',
      tenantId: TENANT_A,
      permissions: [PERMISSIONS.PAYROLL_PROCESS],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/__test/capability-and-permission-check',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('2. capability enabled + permission denied -> existing, unchanged 403 FORBIDDEN', async () => {
    flagState[TENANT_A] = { 'hr.payroll.enabled': true };
    const app = await buildApp();
    const token = await signToken({
      sub: '1',
      tenantId: TENANT_A,
      permissions: ['SOME_OTHER_PERMISSION'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/__test/capability-and-permission-check',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN', message: `Missing permission: ${PERMISSIONS.PAYROLL_PROCESS}` },
    });
    await app.close();
  });

  it('3. capability disabled (permission irrelevant, capability check runs first) -> 403 CAPABILITY_NOT_ENABLED', async () => {
    flagState[TENANT_A] = { 'hr.payroll.enabled': false };
    const app = await buildApp();
    const token = await signToken({
      sub: '1',
      tenantId: TENANT_A,
      permissions: [PERMISSIONS.PAYROLL_PROCESS],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/__test/capability-and-permission-check',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: {
        code: 'CAPABILITY_NOT_ENABLED',
        message: "This tenant's plan does not include HR_PAYROLL.",
        details: { capabilityKey: 'HR_PAYROLL' },
      },
    });
    await app.close();
  });

  it('4. no Authorization header at all -> 401 UNAUTHORIZED', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/__test/capability-check' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('5. tenant isolation: Tenant A enabled -> 200, Tenant B disabled -> 403, same test run', async () => {
    flagState[TENANT_A] = { 'hr.payroll.enabled': true };
    flagState[TENANT_B] = { 'hr.payroll.enabled': false };
    const app = await buildApp();
    const tokenA = await signToken({ sub: '1', tenantId: TENANT_A, permissions: [] });
    const tokenB = await signToken({ sub: '2', tenantId: TENANT_B, permissions: [] });

    const resA = await app.inject({
      method: 'GET',
      url: '/__test/capability-check',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const resB = await app.inject({
      method: 'GET',
      url: '/__test/capability-check',
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(403);
    expect(resB.json().error.code).toBe('CAPABILITY_NOT_ENABLED');
    await app.close();
  });

  it('6. resolution throws (simulated DB/Redis failure) -> 503 CAPABILITY_RESOLUTION_UNAVAILABLE, never 403/500', async () => {
    flagState[TENANT_A] = { 'hr.payroll.enabled': 'throw' };
    const app = await buildApp();
    const token = await signToken({
      sub: '1',
      tenantId: TENANT_A,
      permissions: [PERMISSIONS.PAYROLL_PROCESS],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/__test/capability-check',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
        message: 'Unable to determine capability state. Please retry.',
        details: { capabilityKey: 'HR_PAYROLL' },
      },
    });
    await app.close();
  });
});
