// Phase 3A (HR_PAYROLL capability) — real-DB, real-Redis integration proof. Every other
// capability test in this codebase (payroll-capability.test.ts, the SDK's own
// capability-guard-route.test.ts, Phase 2B's item-batch-capability.test.ts/
// near-expiry-stock-route.test.ts) mocks either `requireCapability` or `PlatformFeatureFlags`
// itself. This file is the first to exercise the full, real path — real Postgres feature_flags
// row -> real PlatformFeatureFlags/TenantScopedCache -> real Redis -> requireCapability -> the
// real route handler — proving the mocked tests' assumption (that requireCapability correctly
// resolves a real row) actually holds. Uses GET /payroll-runs: no FK-dependent fixtures needed,
// since an empty result set for a throwaway tenant is itself the proof (this test is about the
// authorization boundary, not payroll business logic, which payroll-preflight.test.ts etc. own).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import RedisClient from 'ioredis';
import { createDatabaseClient, featureFlags } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { payrollRoutes } from '../api/payroll.routes.js';

const DB_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const TEST_ISSUER = 'erp-payroll-capability-integration-test';

describe.skipIf(!DB_URL)('GET /payroll-runs — HR_PAYROLL capability, real DB + real Redis', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let redis: RedisClient;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 900_950 + Math.floor(Math.random() * 1000);

  const ctxFactory = {
    create: ({ tenantId }: { tenantId: number }) => ({
      db: { raw: db },
      tenantId,
    }),
    rawDb: undefined as unknown,
    getRedis: () => redis,
  } as never;

  async function makeToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: TEST_TENANT,
      email: 'payroll-capability-integration@erp.local',
      roles: [],
      permissions: [PERMISSIONS.PAYROLL_VIEW],
      branchIds: [],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    redis = new RedisClient(REDIS_URL);
    const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(privPem, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pubPem;
    process.env['JWT_ISSUER'] = TEST_ISSUER;

    // requireCapability(...) resolves ctxFactory.rawDb eagerly at route-registration time (it's
    // captured, not called, until a request comes in) — payroll.routes.ts never touches it
    // before then, so this real db client can safely stand in for it.
    (ctxFactory as { rawDb: unknown }).rawDb = db;

    await db.insert(featureFlags).values({
      tenantId: TEST_TENANT,
      flagKey: 'hr.payroll.enabled',
      enabled: false,
    });

    app = Fastify({ logger: false });
    await payrollRoutes(app, ctxFactory);
  });

  afterAll(async () => {
    await app.close();
    await db
      .delete(featureFlags)
      .where(
        and(eq(featureFlags.tenantId, TEST_TENANT), eq(featureFlags.flagKey, 'hr.payroll.enabled'))
      );
    redis.disconnect();
  });

  it('real DB row enabled=false -> real 403 CAPABILITY_NOT_ENABLED (no mocks anywhere in the chain)', async () => {
    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
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
  });

  it('flipping the real row to enabled=true (after invalidating the Redis L2 cache) lets the request through -> 200', async () => {
    await db
      .update(featureFlags)
      .set({ enabled: true })
      .where(
        and(eq(featureFlags.tenantId, TEST_TENANT), eq(featureFlags.flagKey, 'hr.payroll.enabled'))
      );
    // PlatformFeatureFlags caches the resolved value in Redis for 5 minutes (L2_TTL_SECONDS) —
    // the prior test's `false` read is now cached at this exact key (TenantScopedCache's
    // `tenant:{tenantId}:` prefix + feature-flags.ts's `flags:{flagKey}` key), so without this
    // delete the update above would be invisible until the cache naturally expires.
    await redis.del(`tenant:${TEST_TENANT}:flags:hr.payroll.enabled`);

    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { content: unknown[]; totalElements: number } };
    expect(body.data.content).toEqual([]);
    expect(body.data.totalElements).toBe(0);
  });
});
