import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlatformFeatureFlags } from '../../src/feature-flags.js';
import { createMockDb, createMockCache } from '../fixtures/platform.fixtures.js';

describe('PlatformFeatureFlags', () => {
  const TENANT_A = 1;
  const TENANT_B = 99;

  let db: ReturnType<typeof createMockDb>;
  let cache: ReturnType<typeof createMockCache>;
  let flags: PlatformFeatureFlags;

  beforeEach(() => {
    db = createMockDb(TENANT_A);
    cache = createMockCache(TENANT_A);
    flags = new PlatformFeatureFlags(db as never, cache as never, TENANT_A);
  });

  describe('isEnabled', () => {
    it('should return false for unknown flag (safe default)', async () => {
      const result = await flags.isEnabled('unknown.flag');
      expect(result).toBe(false);
    });

    it('should return L2 cached value on second call', async () => {
      // Seed L2 cache directly
      await cache.setJson(`flags:pos.enabled`, { enabled: true });

      const result = await flags.isEnabled('pos.enabled');
      expect(result).toBe(true);
      // DB should NOT be called since it was in L2 cache
      expect(db.raw.select).not.toHaveBeenCalled();
    });

    it('should return L1 cached value without hitting L2', async () => {
      // Seed L2 cache
      await cache.setJson(`flags:sales.quotations.enabled`, { enabled: true });

      // First call — populates L1 from L2
      await flags.isEnabled('sales.quotations.enabled');

      // Second call — should serve from L1 (in-memory)
      const callCountBefore = (cache.getJson as ReturnType<typeof vi.fn>).mock.calls.length;
      await flags.isEnabled('sales.quotations.enabled');
      const callCountAfter = (cache.getJson as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callCountAfter).toBe(callCountBefore); // no additional L2 hits
    });
  });

  describe('getValue', () => {
    it('should return flag value with config', async () => {
      await cache.setJson(`flags:gst.rate`, {
        enabled: true,
        config: { defaultRate: 18, hsnMapping: { '5007': 5 } },
      });

      const result = await flags.getValue('gst.rate');
      expect(result.enabled).toBe(true);
      expect(result.config).toEqual({ defaultRate: 18, hsnMapping: { '5007': 5 } });
    });
  });

  describe('tenant isolation', () => {
    it('should cache flags per-tenant (no cross-tenant leakage)', async () => {
      const cacheB = createMockCache(TENANT_B);
      const dbB = createMockDb(TENANT_B);
      const flagsB = new PlatformFeatureFlags(dbB as never, cacheB as never, TENANT_B);

      // Tenant A has multi-branch enabled
      await cache.setJson(`flags:multi-branch.enabled`, { enabled: true });
      // Tenant B has it disabled
      await cacheB.setJson(`flags:multi-branch.enabled`, { enabled: false });

      const tenantAResult = await flags.isEnabled('multi-branch.enabled');
      const tenantBResult = await flagsB.isEnabled('multi-branch.enabled');

      expect(tenantAResult).toBe(true);
      expect(tenantBResult).toBe(false);
    });
  });

  describe('invalidation', () => {
    it('should remove flag from L1 cache on invalidateLocal', async () => {
      // Seed L2 + L1
      await cache.setJson(`flags:feature.x`, { enabled: true });
      await flags.isEnabled('feature.x'); // populates L1

      flags.invalidateLocal('feature.x');

      // After L1 invalidation, next call must hit L2 again
      const callsBefore = (cache.getJson as ReturnType<typeof vi.fn>).mock.calls.length;
      await flags.isEnabled('feature.x');
      const callsAfter = (cache.getJson as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    it('should remove from both L1 and L2 on invalidate', async () => {
      await cache.setJson(`flags:feature.y`, { enabled: true });
      await flags.isEnabled('feature.y');

      await flags.invalidate('feature.y');

      expect(cache.del).toHaveBeenCalledWith('flags:feature.y');
      expect(cache.publishInvalidation).toHaveBeenCalled();
    });
  });
});
