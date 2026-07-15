// CP-9 follow-up (R14): unit tests for the per-tenant notification rate limiter.
import { describe, it, expect, vi } from 'vitest';
import type Redis from 'ioredis';
import { checkTenantNotificationRateLimit } from '../domain/tenantRateLimit.js';

function makeRedis(incrValues: number[]): Redis {
  let call = 0;
  return {
    incr: vi.fn(async () => incrValues[call++] ?? incrValues[incrValues.length - 1]),
    expire: vi.fn(async () => 1),
  } as unknown as Redis;
}

describe('checkTenantNotificationRateLimit', () => {
  it('allows a request when the count is within the limit', async () => {
    const redis = makeRedis([50]);
    const result = await checkTenantNotificationRateLimit(redis, 1, 200);
    expect(result).toEqual({ allowed: true, limit: 200, remaining: 150 });
  });

  it('allows a request exactly at the limit', async () => {
    const redis = makeRedis([200]);
    const result = await checkTenantNotificationRateLimit(redis, 1, 200);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('rejects a request that exceeds the limit', async () => {
    const redis = makeRedis([201]);
    const result = await checkTenantNotificationRateLimit(redis, 1, 200);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('sets an expiry only on the first increment of a window (count === 1)', async () => {
    const redis = makeRedis([1]);
    await checkTenantNotificationRateLimit(redis, 1, 200);
    expect(redis.expire).toHaveBeenCalledWith(expect.stringContaining('ratelimit:notif:1:'), 60);
  });

  it('does not re-set the expiry on subsequent increments within the same window', async () => {
    const redis = makeRedis([2]);
    await checkTenantNotificationRateLimit(redis, 1, 200);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('respects a tenant-specific higher limit', async () => {
    const redis = makeRedis([500]);
    const result = await checkTenantNotificationRateLimit(redis, 1, 1000);
    expect(result.allowed).toBe(true);
  });

  it('keys different tenants independently', async () => {
    const redis = { incr: vi.fn(async () => 1), expire: vi.fn(async () => 1) } as unknown as Redis;
    await checkTenantNotificationRateLimit(redis, 1, 200);
    await checkTenantNotificationRateLimit(redis, 2, 200);
    const keys = (redis.incr as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(keys[0]).toContain(':1:');
    expect(keys[1]).toContain(':2:');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('fails open (allowed: true) if Redis throws', async () => {
    const redis = {
      incr: vi.fn(async () => {
        throw new Error('Redis connection lost');
      }),
      expire: vi.fn(),
    } as unknown as Redis;
    const result = await checkTenantNotificationRateLimit(redis, 1, 200);
    expect(result.allowed).toBe(true);
  });
});
