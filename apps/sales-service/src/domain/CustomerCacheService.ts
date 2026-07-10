import type { TenantScopedCache } from '@erp/sdk';
import type { Customer } from '@erp/db';

// TTL guideline (ES-16): master data cached for 5 minutes.
const CUSTOMER_CACHE_TTL_SECONDS = 300;

// Cache key: tenant:{tenantId}:customer:{customerId} — the tenant prefix is applied
// by TenantScopedCache itself, matching ItemCacheService's pattern in inventory-service.
export class CustomerCacheService {
  async getCustomer(cache: TenantScopedCache, customerId: number): Promise<Customer | null> {
    return cache.getJson<Customer>(`customer:${customerId}`);
  }

  async setCustomer(cache: TenantScopedCache, customer: Customer): Promise<void> {
    await cache.setJson(`customer:${customer.id}`, customer, CUSTOMER_CACHE_TTL_SECONDS);
  }

  async invalidateCustomer(cache: TenantScopedCache, customerId: number): Promise<void> {
    await cache.del(`customer:${customerId}`);
  }

  async invalidateTenantCustomers(cache: TenantScopedCache): Promise<void> {
    await cache.invalidate('customer:*');
  }
}
