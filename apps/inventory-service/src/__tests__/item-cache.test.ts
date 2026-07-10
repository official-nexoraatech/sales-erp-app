/**
 * ES-16 — ItemCacheService + the cache-aside pattern item.routes.ts wires it into:
 * getItem() checks Redis first, falls back to a DB fetch on miss and populates
 * the cache, and invalidateItem() clears the entry after a write.
 *
 * Uses a minimal in-memory fake of the ioredis surface TenantScopedCache calls
 * (get/setex/set/del/exists/keys) rather than mocking TenantScopedCache itself,
 * so the "Redis key exists after" assertions are real key lookups, not mock-call
 * assertions.
 */
import { describe, it, expect, vi } from 'vitest';
import { TenantScopedCache } from '@erp/sdk';
import { ItemCacheService } from '../domain/ItemCacheService.js';

class FakeRedis {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async setex(key: string, _ttl: number, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }
  async exists(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }
  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
  hasKey(key: string): boolean {
    return this.store.has(key);
  }
}

const TENANT_ID = 42;
const ITEM_ID = 7;
const ITEM = { id: ITEM_ID, tenantId: TENANT_ID, name: 'Cotton Shirt', itemCode: 'CLOTH-001' };

describe('ItemCacheService — ES-16', () => {
  it('getItem() on cache miss returns null, then setItem() stores it so the Redis key exists', async () => {
    const redis = new FakeRedis();
    const cache = new TenantScopedCache(redis as never, TENANT_ID);
    const itemCache = new ItemCacheService();

    const miss = await itemCache.getItem(cache, ITEM_ID);
    expect(miss).toBeNull();

    await itemCache.setItem(cache, ITEM as never);

    expect(redis.hasKey(`tenant:${TENANT_ID}:item:${ITEM_ID}`)).toBe(true);
  });

  it('getItem() on cache hit returns the cached value without touching the DB', async () => {
    const redis = new FakeRedis();
    const cache = new TenantScopedCache(redis as never, TENANT_ID);
    const itemCache = new ItemCacheService();
    await itemCache.setItem(cache, ITEM as never);

    const dbFetch = vi.fn();
    // Mirrors item.routes.ts's cache-aside GET /items/:id handler.
    let item = await itemCache.getItem(cache, ITEM_ID);
    if (!item) {
      item = await dbFetch();
    }

    expect(item).toEqual(ITEM);
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it('invalidateItem() deletes the cache key after an update', async () => {
    const redis = new FakeRedis();
    const cache = new TenantScopedCache(redis as never, TENANT_ID);
    const itemCache = new ItemCacheService();
    await itemCache.setItem(cache, ITEM as never);
    expect(redis.hasKey(`tenant:${TENANT_ID}:item:${ITEM_ID}`)).toBe(true);

    await itemCache.invalidateItem(cache, ITEM_ID);

    expect(redis.hasKey(`tenant:${TENANT_ID}:item:${ITEM_ID}`)).toBe(false);
  });

  it('cache key format is exactly tenant:{tenantId}:item:{itemId}', async () => {
    const redis = new FakeRedis();
    const cache = new TenantScopedCache(redis as never, TENANT_ID);
    const itemCache = new ItemCacheService();

    await itemCache.setItem(cache, ITEM as never);

    expect(redis.hasKey(`tenant:${TENANT_ID}:item:${ITEM_ID}`)).toBe(true);
    expect(await redis.get(`tenant:${TENANT_ID}:item:${ITEM_ID}`)).toBe(JSON.stringify(ITEM));
  });
});
