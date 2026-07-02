import { describe, it, expect, beforeEach } from 'vitest';
import { TenantScopedCache } from '../../src/cache.js';
import { SecurityError } from '@erp/types';
import { createMockRedis } from '../fixtures/platform.fixtures.js';

describe('TenantScopedCache', () => {
  const TENANT_A = 1;
  const TENANT_B = 2;
  let redisA: ReturnType<typeof createMockRedis>;
  let redisB: ReturnType<typeof createMockRedis>;
  let cacheA: TenantScopedCache;
  let cacheB: TenantScopedCache;

  beforeEach(() => {
    redisA = createMockRedis();
    redisB = createMockRedis();
    cacheA = new TenantScopedCache(redisA as never, TENANT_A);
    cacheB = new TenantScopedCache(redisB as never, TENANT_B);
  });

  describe('constructor', () => {
    it('should throw SecurityError for invalid tenant ID', () => {
      expect(() => new TenantScopedCache(redisA as never, 0)).toThrow(SecurityError);
      expect(() => new TenantScopedCache(redisA as never, -1)).toThrow(SecurityError);
    });
  });

  describe('key scoping', () => {
    it('should prefix all keys with tenant namespace', async () => {
      await cacheA.set('invoice:123', 'data');
      expect(redisA.set).toHaveBeenCalledWith(`tenant:${TENANT_A}:invoice:123`, 'data');
    });

    it('should scope keys independently per tenant', async () => {
      await cacheA.set('counter', '10');
      await cacheB.set('counter', '99');

      expect(await cacheA.get('counter')).toBe('10');
      expect(await cacheB.get('counter')).toBe('99');
    });

    it('should use setex when TTL is provided', async () => {
      await cacheA.set('session:xyz', 'value', 300);
      expect(redisA.setex).toHaveBeenCalledWith(`tenant:${TENANT_A}:session:xyz`, 300, 'value');
    });
  });

  describe('get/set', () => {
    it('should return null for missing keys', async () => {
      const result = await cacheA.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should round-trip string values', async () => {
      await cacheA.set('greeting', 'hello');
      const result = await cacheA.get('greeting');
      expect(result).toBe('hello');
    });
  });

  describe('getJson/setJson', () => {
    it('should serialize and deserialize JSON values', async () => {
      const obj = { invoiceId: 42, amount: 1500.50, status: 'CONFIRMED' };
      await cacheA.setJson('invoice:42', obj, 60);
      const result = await cacheA.getJson<typeof obj>('invoice:42');
      expect(result).toEqual(obj);
    });

    it('should return null for missing JSON keys', async () => {
      const result = await cacheA.getJson('missing:key');
      expect(result).toBeNull();
    });
  });

  describe('del', () => {
    it('should delete a key', async () => {
      await cacheA.set('to-delete', 'value');
      await cacheA.del('to-delete');
      expect(await cacheA.get('to-delete')).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await cacheA.set('present', '1');
      expect(await cacheA.exists('present')).toBe(true);
    });

    it('should return false for missing key', async () => {
      expect(await cacheA.exists('absent')).toBe(false);
    });
  });
});
