import { eq, and, isNull, or } from 'drizzle-orm';
import { featureFlags } from '@erp/db';
import type { TenantScopedDatabase } from './database.js';
import type { TenantScopedCache } from './cache.js';

export interface FeatureFlagValue {
  enabled: boolean;
  config?: Record<string, unknown>;
}

const L1_TTL_MS = 30_000;       // 30 seconds in-memory
const L2_TTL_SECONDS = 300;     // 5 minutes in Redis
const FLAGS_INVALIDATE_CHANNEL = 'erp:feature-flags:invalidate';

// ─── L1 (in-memory per service instance) ─────────────────────────────────
interface L1Entry {
  value: FeatureFlagValue;
  expiresAt: number;
}

// PlatformFeatureFlags — L1 (in-memory) + L2 (Redis) cache, hot-reloadable
export class PlatformFeatureFlags {
  private readonly l1: Map<string, L1Entry> = new Map();

  constructor(
    private readonly db: TenantScopedDatabase,
    private readonly cache: TenantScopedCache,
    private readonly tenantId: number
  ) {}

  async isEnabled(flagKey: string): Promise<boolean> {
    const flag = await this.getValue(flagKey);
    return flag.enabled;
  }

  async getValue(flagKey: string): Promise<FeatureFlagValue> {
    // L1 check
    const l1Key = `${this.tenantId}:${flagKey}`;
    const l1Entry = this.l1.get(l1Key);
    if (l1Entry !== undefined && l1Entry.expiresAt > Date.now()) {
      return l1Entry.value;
    }

    // L2 check (Redis)
    const l2Key = `flags:${flagKey}`;
    const cached = await this.cache.getJson<FeatureFlagValue>(l2Key);
    if (cached !== null) {
      this.setL1(l1Key, cached);
      return cached;
    }

    // DB fallback — try tenant-specific override first, then global default
    const value = await this.fetchFromDb(flagKey);
    await this.cache.setJson(l2Key, value, L2_TTL_SECONDS);
    this.setL1(l1Key, value);
    return value;
  }

  private async fetchFromDb(flagKey: string): Promise<FeatureFlagValue> {
    const rows = await this.db.raw
      .select()
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.flagKey, flagKey),
          or(
            eq(featureFlags.tenantId as unknown as never, this.tenantId as never),
            isNull(featureFlags.tenantId)
          )
        )
      )
      .orderBy(featureFlags.tenantId); // tenant-specific rows (non-null tenantId) last

    // Tenant-specific override takes precedence over global default
    const tenantSpecific = rows.find((r) => r.tenantId === this.tenantId);
    const globalDefault = rows.find((r) => r.tenantId === null);

    const row = tenantSpecific ?? globalDefault;
    if (!row) {
      // Flag not found — default to disabled (safe default)
      return { enabled: false };
    }

    const config = row.config as Record<string, unknown> | null;
    return {
      enabled: row.enabled,
      ...(config != null ? { config } : {}),
    };
  }

  private setL1(key: string, value: FeatureFlagValue): void {
    this.l1.set(key, { value, expiresAt: Date.now() + L1_TTL_MS });
  }

  // Called when Redis publishes an invalidation event
  invalidateLocal(flagKey: string): void {
    const l1Key = `${this.tenantId}:${flagKey}`;
    this.l1.delete(l1Key);
  }

  // Publish invalidation so all service instances drop their L1 cache
  async invalidate(flagKey: string): Promise<void> {
    this.invalidateLocal(flagKey);
    await this.cache.del(`flags:${flagKey}`);
    await this.cache.publishInvalidation(FLAGS_INVALIDATE_CHANNEL, flagKey);
  }

  // Set up hot-reload listener (call once per service instance)
  static subscribeToInvalidations(
    redis: import('ioredis').default,
    instances: PlatformFeatureFlags[]
  ): void {
    const subscriber = redis.duplicate();
    void subscriber.subscribe(FLAGS_INVALIDATE_CHANNEL);
    subscriber.on('message', (_channel, message: string) => {
      const { flagKey } = JSON.parse(message) as { tenantId: number; key: string; flagKey?: string };
      if (flagKey) {
        for (const instance of instances) {
          instance.invalidateLocal(flagKey);
        }
      }
    });
  }
}
