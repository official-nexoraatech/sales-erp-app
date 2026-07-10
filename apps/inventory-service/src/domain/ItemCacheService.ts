import type { TenantScopedCache } from '@erp/sdk';
import type { Item } from '@erp/db';

// TTL guideline (ES-16): master data cached for 5 minutes.
const ITEM_CACHE_TTL_SECONDS = 300;

// Cache key: tenant:{tenantId}:item:{itemId} — the tenant prefix is applied by
// TenantScopedCache itself, so every method here just takes the caller's
// already tenant-scoped `cache` (ctx.cache) instead of a raw tenantId, per the
// codebase's existing "always go through TenantScopedCache" rule.
export class ItemCacheService {
  async getItem(cache: TenantScopedCache, itemId: number): Promise<Item | null> {
    return cache.getJson<Item>(`item:${itemId}`);
  }

  async setItem(cache: TenantScopedCache, item: Item): Promise<void> {
    await cache.setJson(`item:${item.id}`, item, ITEM_CACHE_TTL_SECONDS);
  }

  async invalidateItem(cache: TenantScopedCache, itemId: number): Promise<void> {
    await cache.del(`item:${itemId}`);
  }

  async invalidateTenantItems(cache: TenantScopedCache): Promise<void> {
    await cache.invalidate('item:*');
  }
}
