// Real Postgres + real Redis proof that isCapabilityEnabled resolves correctly through the
// actual PlatformFeatureFlags L1/L2/DB path — no mocks. Mirrors the DATABASE_URL-gated
// skip convention already used by apps/tenant-service/src/__tests__/tenant.integration.test.ts
// (describe.skipIf(!DB_URL)), extended with a REDIS_URL gate since this phase's capability
// resolution also needs a real cache layer to prove L1/L2/invalidation behavior — no such
// Redis-gated integration test convention existed in this repo before this phase.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import { featureFlags } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import { isCapabilityEnabled } from '../../src/capability-guard.js';
import { PlatformFeatureFlags } from '../../src/feature-flags.js';
import { TenantScopedDatabase } from '../../src/database.js';
import { TenantScopedCache } from '../../src/cache.js';

const DB_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];

// Distinctive, unlikely-to-collide-with-real-data tenant IDs, cleaned up in afterAll.
const TENANT_A = 900_001;
const TENANT_B = 900_002;

describe.skipIf(!DB_URL || !REDIS_URL)('Capability resolution — real Postgres + Redis', () => {
  let db: ErpDatabase;
  let redis: Redis;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    redis = new Redis(REDIS_URL!); // connects immediately (default, non-lazy)

    // Insert-if-absent, then explicitly (re)assert each row's exact value — makes this
    // beforeAll idempotent across reruns regardless of what a prior run left behind.
    await db
      .insert(featureFlags)
      .values([
        { tenantId: TENANT_A, flagKey: 'hr.payroll.enabled', enabled: true },
        { tenantId: TENANT_B, flagKey: 'hr.payroll.enabled', enabled: false },
        { tenantId: TENANT_B, flagKey: 'pos.enabled', enabled: false },
      ])
      .onConflictDoNothing();

    await db
      .update(featureFlags)
      .set({ enabled: true })
      .where(
        and(eq(featureFlags.tenantId, TENANT_A), eq(featureFlags.flagKey, 'hr.payroll.enabled'))
      );
    await db
      .update(featureFlags)
      .set({ enabled: false })
      .where(
        and(eq(featureFlags.tenantId, TENANT_B), eq(featureFlags.flagKey, 'hr.payroll.enabled'))
      );
    await db
      .update(featureFlags)
      .set({ enabled: false })
      .where(and(eq(featureFlags.tenantId, TENANT_B), eq(featureFlags.flagKey, 'pos.enabled')));
  });

  afterAll(async () => {
    await db.delete(featureFlags).where(inArray(featureFlags.tenantId, [TENANT_A, TENANT_B]));
    redis.disconnect();
  });

  it('resolves HR_PAYROLL true for a tenant whose hr.payroll.enabled flag is true', async () => {
    await expect(isCapabilityEnabled('HR_PAYROLL', TENANT_A, db, redis)).resolves.toBe(true);
  });

  it('resolves POS false for a tenant whose pos.enabled flag is false', async () => {
    await expect(isCapabilityEnabled('POS', TENANT_B, db, redis)).resolves.toBe(false);
  });

  it('tenant isolation: Tenant A (enabled) and Tenant B (disabled) resolve independently in the same run', async () => {
    const [resultA, resultB] = await Promise.all([
      isCapabilityEnabled('HR_PAYROLL', TENANT_A, db, redis),
      isCapabilityEnabled('HR_PAYROLL', TENANT_B, db, redis),
    ]);
    expect(resultA).toBe(true);
    expect(resultB).toBe(false);
  });

  it('cache invalidation: a flag toggle is visible on the next call after invalidate()', async () => {
    // Prime the cache with the current (false) value.
    await expect(isCapabilityEnabled('POS', TENANT_B, db, redis)).resolves.toBe(false);

    // Toggle directly in the DB, bypassing the cache.
    await db
      .update(featureFlags)
      .set({ enabled: true })
      .where(and(eq(featureFlags.tenantId, TENANT_B), eq(featureFlags.flagKey, 'pos.enabled')));

    // Without invalidation, a fresh isCapabilityEnabled call could still serve the stale
    // L1/L2-cached false value — invalidate() is what this phase inherits, not reinvents.
    const tsDb = new TenantScopedDatabase(TENANT_B, db);
    const tsCache = new TenantScopedCache(redis, TENANT_B);
    const flags = new PlatformFeatureFlags(tsDb, tsCache, TENANT_B);
    await flags.invalidate('pos.enabled');

    await expect(isCapabilityEnabled('POS', TENANT_B, db, redis)).resolves.toBe(true);

    // Restore for test idempotency across reruns.
    await db
      .update(featureFlags)
      .set({ enabled: false })
      .where(and(eq(featureFlags.tenantId, TENANT_B), eq(featureFlags.flagKey, 'pos.enabled')));
    await flags.invalidate('pos.enabled');
  });
});
