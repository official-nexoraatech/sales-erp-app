// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — redlock v5 beta exports field lacks types condition; types exist at dist/index.d.ts
import Redlock, { type Lock } from 'redlock';
import type Redis from 'ioredis';

export interface LockOptions {
  ttlMs: number;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface AcquiredLock {
  fencingToken: number;
  release: () => Promise<void>;
}

export class DistributedLockManager {
  private readonly redlock: Redlock;
  // Monotonic fencing token counter key (per resource, in Redis)
  private static readonly FENCE_KEY_PREFIX = 'erp:fence:';

  constructor(private readonly redis: Redis) {
    this.redlock = new Redlock([redis as unknown as Parameters<typeof Redlock>[0][0]], {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
      automaticExtensionThreshold: 500,
    });

    this.redlock.on('error', (_error: Error) => {
      // Suppress lock errors — callers handle ExecutionError
    });
  }

  // Primary API: acquire, execute fn atomically, release
  async withLock<T>(resource: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const lockKey = `erp:lock:${resource}`;
    const lock: Lock = await this.redlock.acquire([lockKey], ttlMs);
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }

  // Advanced API: acquire with fencing token (for optimistic concurrency)
  async acquire(resource: string, options: LockOptions): Promise<AcquiredLock> {
    const lockKey = `erp:lock:${resource}`;
    const fenceKey = `${DistributedLockManager.FENCE_KEY_PREFIX}${resource}`;

    const lock: Lock = await this.redlock.acquire([lockKey], options.ttlMs);

    try {
      // Monotonically increasing fencing token — prevents stale operations after lock expiry
      const fencingToken = await this.redis.incr(fenceKey);
      await this.redis.expire(fenceKey, 86400); // Fence counter expires after 24 hours

      return {
        fencingToken,
        release: async () => {
          await lock.release();
        },
      };
    } catch (err) {
      // Don't leak the lock until TTL if anything after acquisition fails
      await lock.release().catch(() => {});
      throw err;
    }
  }

  // Check if a resource is currently locked
  async isLocked(resource: string): Promise<boolean> {
    const lockKey = `erp:lock:${resource}`;
    const result = await this.redis.exists(lockKey);
    return result > 0;
  }

  on(event: 'error', handler: (error: Error) => void): this {
    this.redlock.on('error', handler);
    return this;
  }
}
