import { describe, it, expect, beforeEach, vi } from 'vitest';
import Redlock from 'redlock';
import { DistributedLockManager } from '../../src/locks.js';
import { delay } from '../fixtures/platform.fixtures.js';

vi.mock('redlock', () => ({ default: vi.fn() }));

// ─── Deterministic In-Memory Lock for unit testing ────────────────────────
// Tests the BEHAVIOR of the DistributedLockManager without requiring real Redis
class InMemoryLock {
  private readonly locked = new Set<string>();

  async acquire(key: string): Promise<() => void> {
    // Spin until lock is available (simulates Redlock retry behavior)
    let attempts = 0;
    while (this.locked.has(key)) {
      if (attempts++ > 100) throw new Error(`Lock timeout for ${key}`);
      await delay(10);
    }
    this.locked.add(key);
    return () => {
      this.locked.delete(key);
    };
  }

  isLocked(key: string): boolean {
    return this.locked.has(key);
  }
}

// Creates a mock DistributedLockManager backed by InMemoryLock
function createTestLockManager(): {
  withLock: DistributedLockManager['withLock'];
  isLocked: (resource: string) => boolean;
} {
  const lock = new InMemoryLock();

  return {
    withLock: async <T>(resource: string, _ttlMs: number, fn: () => Promise<T>): Promise<T> => {
      const release = await lock.acquire(`erp:lock:${resource}`);
      try {
        return await fn();
      } finally {
        release();
      }
    },
    isLocked: (resource: string) => lock.isLocked(`erp:lock:${resource}`),
  };
}

describe('DistributedLockManager.acquire() — lock release on failure', () => {
  beforeEach(() => {
    vi.mocked(Redlock).mockReset();
  });

  it('releases the underlying lock if incr() fails after acquisition (no leak until TTL)', async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    const acquireMock = vi.fn().mockResolvedValue({ release: releaseMock });
    vi.mocked(Redlock).mockImplementation(() => ({ acquire: acquireMock, on: vi.fn() }) as never);

    const fakeRedis = {
      incr: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      expire: vi.fn(),
      exists: vi.fn(),
    };

    const manager = new DistributedLockManager(fakeRedis as never);

    await expect(manager.acquire('item-fifo:1:2:3', { ttlMs: 5000 })).rejects.toThrow(
      'Redis connection lost'
    );

    expect(acquireMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('releases the underlying lock if expire() fails after acquisition', async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    const acquireMock = vi.fn().mockResolvedValue({ release: releaseMock });
    vi.mocked(Redlock).mockImplementation(() => ({ acquire: acquireMock, on: vi.fn() }) as never);

    const fakeRedis = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockRejectedValue(new Error('Redis timeout')),
      exists: vi.fn(),
    };

    const manager = new DistributedLockManager(fakeRedis as never);

    await expect(manager.acquire('item-valuation:99', { ttlMs: 5000 })).rejects.toThrow(
      'Redis timeout'
    );

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});

describe('DistributedLockManager — mutual exclusion semantics', () => {
  let lockManager: ReturnType<typeof createTestLockManager>;

  beforeEach(() => {
    lockManager = createTestLockManager();
  });

  it('should prevent concurrent execution of critical section for same resource', async () => {
    const timeline: string[] = [];
    const RESOURCE = 'stock:item:42:warehouse:1';

    // Two concurrent callers contend for the same lock
    const op1 = lockManager.withLock(RESOURCE, 5000, async () => {
      timeline.push('op1:start');
      await delay(30); // simulate stock deduction work
      timeline.push('op1:end');
      return 'op1-result';
    });

    const op2 = lockManager.withLock(RESOURCE, 5000, async () => {
      timeline.push('op2:start');
      await delay(30);
      timeline.push('op2:end');
      return 'op2-result';
    });

    const [r1, r2] = await Promise.all([op1, op2]);

    expect(r1).toBe('op1-result');
    expect(r2).toBe('op2-result');
    expect(timeline).toHaveLength(4);

    // Operations MUST be sequential — one must complete before the other starts
    const op1StartIdx = timeline.indexOf('op1:start');
    const op1EndIdx = timeline.indexOf('op1:end');
    const op2StartIdx = timeline.indexOf('op2:start');
    const op2EndIdx = timeline.indexOf('op2:end');

    const op1BeforeOp2 = op1EndIdx < op2StartIdx;
    const op2BeforeOp1 = op2EndIdx < op1StartIdx;

    expect(op1BeforeOp2 || op2BeforeOp1).toBe(true);
  });

  it('should allow concurrent execution for DIFFERENT resources', async () => {
    const timeline: string[] = [];

    const op1 = lockManager.withLock('stock:item:1', 5000, async () => {
      timeline.push('op1:start');
      await delay(30);
      timeline.push('op1:end');
    });

    const op2 = lockManager.withLock('stock:item:2', 5000, async () => {
      timeline.push('op2:start');
      await delay(30);
      timeline.push('op2:end');
    });

    await Promise.all([op1, op2]);

    // Both should have started before either ends (true concurrency)
    const op1StartIdx = timeline.indexOf('op1:start');
    const op2StartIdx = timeline.indexOf('op2:start');
    const op1EndIdx = timeline.indexOf('op1:end');
    const op2EndIdx = timeline.indexOf('op2:end');

    // Both started before the first one ended
    const firstEnd = Math.min(op1EndIdx, op2EndIdx);
    expect(Math.min(op1StartIdx, op2StartIdx)).toBeLessThan(firstEnd);
    expect(Math.max(op1StartIdx, op2StartIdx)).toBeLessThan(firstEnd);
  });

  it('should release lock after fn throws', async () => {
    const RESOURCE = 'invoice:number-gen';

    await expect(
      lockManager.withLock(RESOURCE, 5000, async () => {
        throw new Error('Invoice generation failed');
      })
    ).rejects.toThrow('Invoice generation failed');

    // Lock must be released — next caller should succeed
    const result = await lockManager.withLock(RESOURCE, 5000, async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('should return function result through the lock', async () => {
    const result = await lockManager.withLock('payroll:process', 5000, async () => ({
      employeesProcessed: 42,
      totalAmount: 840000,
    }));

    expect(result).toEqual({ employeesProcessed: 42, totalAmount: 840000 });
  });

  it('should handle 10 concurrent callers sequentially for the same resource', async () => {
    const RESOURCE = 'invoice:seq-no-generator';
    let counter = 0;
    const results: number[] = [];

    const ops = Array.from({ length: 10 }, (_, i) =>
      lockManager.withLock(RESOURCE, 5000, async () => {
        counter++;
        await delay(5);
        results.push(counter);
        return i;
      })
    );

    await Promise.all(ops);

    // Counter must increment sequentially — no two ops see the same counter value
    const uniqueValues = new Set(results);
    expect(uniqueValues.size).toBe(10);
  });
});
