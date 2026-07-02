import type Redis from 'ioredis';
import { SecurityError } from '@erp/types';

// Every Redis key is namespaced: tenant:{tenantId}:{key} — bypassing this is a security error
export class TenantScopedCache {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: Redis,
    public readonly tenantId: number
  ) {
    if (!tenantId || tenantId <= 0) {
      throw new SecurityError('Tenant context required for cache access');
    }
    this.keyPrefix = `tenant:${tenantId}:`;
  }

  private scopeKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(this.scopeKey(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.redis.setex(this.scopeKey(key), ttlSeconds, value);
    } else {
      await this.redis.set(this.scopeKey(key), value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.scopeKey(key));
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(this.scopeKey(key));
    return result === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(this.scopeKey(key), ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(this.scopeKey(key));
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(this.scopeKey(key));
  }

  async incrBy(key: string, increment: number): Promise<number> {
    return this.redis.incrby(this.scopeKey(key), increment);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async invalidate(pattern: string): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}${pattern}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // Publish invalidation event for L1 caches across service instances
  async publishInvalidation(channel: string, key: string): Promise<void> {
    await this.redis.publish(channel, JSON.stringify({ tenantId: this.tenantId, key }));
  }
}
