import { vi } from 'vitest';
import type { TenantScopedCache } from '../../src/cache.js';
import type { TenantScopedDatabase } from '../../src/database.js';
import type { PlatformFeatureFlags, FeatureFlagValue } from '../../src/feature-flags.js';
import type { PlatformAuditLogger } from '../../src/audit.js';

// ─── Mock Redis ────────────────────────────────────────────────────────────
export function createMockRedis() {
  const store = new Map<string, string>();
  const expirations = new Map<string, number>();

  function isExpired(key: string): boolean {
    const exp = expirations.get(key);
    return exp !== undefined && exp < Date.now();
  }

  function getFromStore(key: string): string | null {
    if (isExpired(key)) {
      store.delete(key);
      expirations.delete(key);
      return null;
    }
    return store.get(key) ?? null;
  }

  const redis = {
    get: vi.fn(async (key: string) => getFromStore(key)),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, value);
      expirations.set(key, Date.now() + ttl * 1000);
      return 'OK' as const;
    }),
    del: vi.fn(async (key: string, ...rest: string[]) => {
      let count = 0;
      for (const k of [key, ...rest]) {
        if (store.delete(k)) count++;
        expirations.delete(k);
      }
      return count;
    }),
    exists: vi.fn(async (key: string) => (getFromStore(key) !== null ? 1 : 0) as 0 | 1),
    expire: vi.fn(async (key: string, ttl: number) => {
      expirations.set(key, Date.now() + ttl * 1000);
      return 1 as const;
    }),
    ttl: vi.fn(async (key: string) => {
      const exp = expirations.get(key);
      if (!exp) return -1;
      return Math.ceil((exp - Date.now()) / 1000);
    }),
    incr: vi.fn(async (key: string) => {
      const current = parseInt(getFromStore(key) ?? '0', 10);
      const next = current + 1;
      store.set(key, String(next));
      return next;
    }),
    incrby: vi.fn(async (key: string, n: number) => {
      const current = parseInt(getFromStore(key) ?? '0', 10);
      const next = current + n;
      store.set(key, String(next));
      return next;
    }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    }),
    publish: vi.fn(async () => 0),
    quit: vi.fn(async () => 'OK' as const),
    duplicate: vi.fn(() => ({
      subscribe: vi.fn(async () => {}),
      on: vi.fn(),
    })),
    _store: store,
  };

  return redis;
}

// ─── Mock TenantScopedCache ────────────────────────────────────────────────
// Implements the same interface as TenantScopedCache but entirely in-memory.
// Used when testing components that DEPEND ON TenantScopedCache (not testing cache itself).
export function createMockCache(tenantId: number) {
  const store = new Map<string, string>();
  const prefix = `tenant:${tenantId}:`;

  const mock = {
    tenantId,
    get: vi.fn(async (key: string) => store.get(`${prefix}${key}`) ?? null),
    set: vi.fn(async (key: string, value: string, _ttl?: number) => {
      store.set(`${prefix}${key}`, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(`${prefix}${key}`);
    }),
    exists: vi.fn(async (key: string) => store.has(`${prefix}${key}`)),
    expire: vi.fn(async (_key: string, _ttl: number) => {}),
    ttl: vi.fn(async (_key: string) => -1),
    incr: vi.fn(async (_key: string) => 1),
    incrBy: vi.fn(async (_key: string, _n: number) => 1),
    getJson: vi.fn(async <T>(key: string): Promise<T | null> => {
      const raw = store.get(`${prefix}${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    }),
    setJson: vi.fn(async (key: string, value: unknown, _ttl?: number) => {
      store.set(`${prefix}${key}`, JSON.stringify(value));
    }),
    invalidate: vi.fn(async (_pattern: string) => {}),
    publishInvalidation: vi.fn(async (_channel: string, _key: string) => {}),
    _store: store,
  };

  return mock as typeof mock & Pick<TenantScopedCache, 'tenantId'>;
}

// ─── Mock Database ─────────────────────────────────────────────────────────
export function createMockDb(tenantId: number) {
  const insertValues = vi.fn(async () => [{}]);
  const insertBuilder = vi.fn(() => ({ values: insertValues }));

  // Drizzle chain: select().from(table).where(cond).orderBy(col)
  // Each builder method returns a new builder; the final method is thenable (awaitable)
  const selectOrderBy = vi.fn(async () => [] as unknown[]);
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere, orderBy: selectOrderBy }));
  const selectBuilder = vi.fn(() => ({ from: selectFrom }));

  const mock = {
    tenantId,
    raw: {
      insert: insertBuilder,
      select: selectBuilder,
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
      execute: vi.fn(async () => [] as unknown[]),
      transaction: vi.fn(async <T>(fn: (trx: unknown) => Promise<T>) => fn({})),
    } as unknown as TenantScopedDatabase['raw'],
    transaction: vi.fn(async <T>(fn: (db: TenantScopedDatabase) => Promise<T>) =>
      fn(mock as unknown as TenantScopedDatabase)
    ),
    insert: vi.fn(async () => ({})),
    findMany: vi.fn(async () => [] as unknown[]),
    insertIntoOutbox: vi.fn(async () => {}),
    execute: vi.fn(async () => null),
  };

  return mock;
}

// ─── Mock PlatformAuditLogger ─────────────────────────────────────────────
export function createMockAuditLogger(): Pick<PlatformAuditLogger, 'log' | 'logBatch'> {
  return {
    log: vi.fn(async () => {}),
    logBatch: vi.fn(async () => {}),
  };
}

// ─── Mock PlatformFeatureFlags ────────────────────────────────────────────
export function createMockFeatureFlags(
  overrides: Record<string, FeatureFlagValue> = {}
): Pick<PlatformFeatureFlags, 'isEnabled' | 'getValue' | 'invalidate' | 'invalidateLocal'> {
  const defaults: Record<string, FeatureFlagValue> = {
    'pos.enabled': { enabled: true },
    'multi-branch.enabled': { enabled: false },
    'inventory.variants.enabled': { enabled: true },
    'sales.quotations.enabled': { enabled: true },
    ...overrides,
  };

  return {
    isEnabled: vi.fn(async (key: string) => defaults[key]?.enabled ?? false),
    getValue: vi.fn(async (key: string) => defaults[key] ?? { enabled: false }),
    invalidate: vi.fn(async (_key: string) => {}),
    invalidateLocal: vi.fn((_key: string) => {}),
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
