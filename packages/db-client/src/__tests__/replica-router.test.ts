import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { ReplicaRouter } from '../replica-router.js';
import { isReplicaHealthy } from '../replica-health.js';

function makeDb(execute: ReturnType<typeof vi.fn>): never {
  return { execute } as never;
}

describe('isReplicaHealthy', () => {
  it('returns true when lag is within the threshold', async () => {
    const execute = vi.fn().mockResolvedValue([{ lag_ms: 1200 }]);
    await expect(isReplicaHealthy(makeDb(execute), 5000)).resolves.toBe(true);
  });

  it('returns false when lag exceeds the threshold', async () => {
    const execute = vi.fn().mockResolvedValue([{ lag_ms: 9000 }]);
    await expect(isReplicaHealthy(makeDb(execute), 5000)).resolves.toBe(false);
  });

  it('returns false when the lag query throws', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(isReplicaHealthy(makeDb(execute), 5000)).resolves.toBe(false);
  });

  it('returns false when lag_ms is null (not currently replicating)', async () => {
    const execute = vi.fn().mockResolvedValue([{ lag_ms: null }]);
    await expect(isReplicaHealthy(makeDb(execute), 5000)).resolves.toBe(false);
  });
});

describe('ReplicaRouter', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('forRead() returns the replica when healthy', async () => {
    const primaryExecute = vi.fn();
    const replicaExecute = vi.fn().mockResolvedValue([{ lag_ms: 100 }]);
    const primary = makeDb(primaryExecute);
    const replica = makeDb(replicaExecute);

    const router = new ReplicaRouter(primary, replica);
    const db = await router.forRead();

    expect(db).toBe(replica);
  });

  it('forRead() falls back to primary when replica is lagging, without throwing', async () => {
    const primary = makeDb(vi.fn());
    const replicaExecute = vi.fn().mockResolvedValue([{ lag_ms: 20000 }]);
    const replica = makeDb(replicaExecute);
    const onFallback = vi.fn();

    const router = new ReplicaRouter(primary, replica, { maxLagMs: 5000, onFallback });
    const db = await router.forRead();

    expect(db).toBe(primary);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('forRead() falls back to primary when the replica connection fails, without throwing', async () => {
    const primary = makeDb(vi.fn());
    const replicaExecute = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const replica = makeDb(replicaExecute);
    const onFallback = vi.fn();

    const router = new ReplicaRouter(primary, replica, { onFallback });

    await expect(router.forRead()).resolves.toBe(primary);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('caches the health check result within healthCacheMs', async () => {
    const primary = makeDb(vi.fn());
    const replicaExecute = vi.fn().mockResolvedValue([{ lag_ms: 100 }]);
    const replica = makeDb(replicaExecute);

    const router = new ReplicaRouter(primary, replica, { healthCacheMs: 60_000 });
    await router.forRead();
    await router.forRead();
    await router.forRead();

    expect(replicaExecute).toHaveBeenCalledTimes(1);
  });

  it('re-checks health after the cache window expires', async () => {
    vi.useFakeTimers();
    const primary = makeDb(vi.fn());
    const replicaExecute = vi.fn().mockResolvedValue([{ lag_ms: 100 }]);
    const replica = makeDb(replicaExecute);

    const router = new ReplicaRouter(primary, replica, { healthCacheMs: 1000 });
    await router.forRead();
    vi.advanceTimersByTime(1500);
    await router.forRead();

    expect(replicaExecute).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
