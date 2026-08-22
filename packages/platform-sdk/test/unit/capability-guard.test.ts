import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErpDatabase } from '@erp/db';
import type Redis from 'ioredis';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type * as ErpTypes from '@erp/types';

// isCapabilityEnabled constructs its own PlatformFeatureFlags internally (see
// 05-platform-sdk.md §2) — mocking the class here is the only way to unit-test resolution
// logic and the preHandler's outcomes without a real DB/Redis (that's what the separate,
// DATABASE_URL/REDIS_URL-gated integration test proves instead).
let flagState: Record<string, boolean> = {};

vi.mock('../../src/feature-flags.js', () => ({
  PlatformFeatureFlags: vi.fn().mockImplementation(() => ({
    isEnabled: vi.fn(async (flagKey: string) => flagState[flagKey] ?? false),
  })),
}));

// Extends the real registry with a synthetic X-requires-Y pair (dependency composition is
// otherwise untestable — this phase's 2 real entries, HR_PAYROLL/POS, have no dependencies
// on each other, per 02-capability-model.md §4's deliberate choice not to force an
// artificial real dependency).
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    CAPABILITY_REGISTRY: {
      ...actual.CAPABILITY_REGISTRY,
      TEST_X: {
        key: 'TEST_X',
        name: 'Test X',
        domain: 'Test',
        owningService: 'test-service',
        flagKey: 'test.x.enabled',
        requires: ['TEST_Y'],
        status: 'GA',
        applicableBusinessTypes: [],
        permissions: [],
      },
      TEST_Y: {
        key: 'TEST_Y',
        name: 'Test Y',
        domain: 'Test',
        owningService: 'test-service',
        flagKey: 'test.y.enabled',
        requires: [],
        status: 'GA',
        applicableBusinessTypes: [],
        permissions: [],
      },
    },
  };
});

const { requireCapability, isCapabilityEnabled } = await import('../../src/capability-guard.js');

const FAKE_DB = {} as ErpDatabase;
const FAKE_REDIS = {} as Redis;

function makeReply(): FastifyReply & { statusCode?: number; body?: unknown } {
  const reply: Partial<FastifyReply> & { statusCode?: number; body?: unknown } = {};
  reply.code = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply as FastifyReply;
  });
  reply.send = vi.fn((payload: unknown) => {
    reply.body = payload;
    return reply as FastifyReply;
  });
  return reply as FastifyReply & { statusCode?: number; body?: unknown };
}

function makeRequest(auth?: { tenantId: number }): FastifyRequest {
  return {
    auth,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  } as unknown as FastifyRequest;
}

describe('isCapabilityEnabled', () => {
  beforeEach(() => {
    flagState = {};
  });

  it('resolves true when the underlying flag is enabled', async () => {
    flagState['pos.enabled'] = true;
    await expect(isCapabilityEnabled('POS', 1, FAKE_DB, FAKE_REDIS)).resolves.toBe(true);
  });

  it('resolves false when the underlying flag is disabled', async () => {
    flagState['pos.enabled'] = false;
    await expect(isCapabilityEnabled('POS', 1, FAKE_DB, FAKE_REDIS)).resolves.toBe(false);
  });

  it('resolves false (fail-closed) for an unregistered capability key', async () => {
    await expect(
      isCapabilityEnabled('NOT_A_REAL_CAPABILITY', 1, FAKE_DB, FAKE_REDIS)
    ).resolves.toBe(false);
  });

  it('propagates a resolution error (does not swallow it) — caller (requireCapability) is responsible for catching', async () => {
    vi.mocked(
      (await import('../../src/feature-flags.js')).PlatformFeatureFlags
    ).mockImplementationOnce(
      () =>
        ({
          isEnabled: vi.fn().mockRejectedValue(new Error('DB connection lost')),
        }) as never
    );
    await expect(isCapabilityEnabled('POS', 1, FAKE_DB, FAKE_REDIS)).rejects.toThrow(
      'DB connection lost'
    );
  });

  it('dependency composition: X requires Y — Y disabled makes X resolve false even though X itself is enabled', async () => {
    flagState['test.x.enabled'] = true;
    flagState['test.y.enabled'] = false;
    await expect(isCapabilityEnabled('TEST_X', 1, FAKE_DB, FAKE_REDIS)).resolves.toBe(false);
  });

  it('dependency composition: X requires Y — both enabled resolves X true', async () => {
    flagState['test.x.enabled'] = true;
    flagState['test.y.enabled'] = true;
    await expect(isCapabilityEnabled('TEST_X', 1, FAKE_DB, FAKE_REDIS)).resolves.toBe(true);
  });
});

describe('requireCapability (preHandler)', () => {
  beforeEach(() => {
    flagState = {};
  });

  it('1. unauthenticated (no request.auth) -> 401 UNAUTHORIZED', async () => {
    const preHandler = requireCapability('POS', FAKE_DB, FAKE_REDIS);
    const request = makeRequest(undefined);
    const reply = makeReply();

    await preHandler(request, reply, () => undefined);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
  });

  it('2. capability resolves cleanly disabled -> 403 CAPABILITY_NOT_ENABLED with details.capabilityKey', async () => {
    flagState['pos.enabled'] = false;
    const preHandler = requireCapability('POS', FAKE_DB, FAKE_REDIS);
    const request = makeRequest({ tenantId: 1 });
    const reply = makeReply();

    await preHandler(request, reply, () => undefined);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({
      error: {
        code: 'CAPABILITY_NOT_ENABLED',
        message: "This tenant's plan does not include POS.",
        details: { capabilityKey: 'POS' },
      },
    });
  });

  it('3. capability resolves enabled -> falls through with no reply', async () => {
    flagState['pos.enabled'] = true;
    const preHandler = requireCapability('POS', FAKE_DB, FAKE_REDIS);
    const request = makeRequest({ tenantId: 1 });
    const reply = makeReply();

    await preHandler(request, reply, () => undefined);

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('4. resolution throws -> 503 CAPABILITY_RESOLUTION_UNAVAILABLE, never 403 and never uncaught', async () => {
    vi.mocked(
      (await import('../../src/feature-flags.js')).PlatformFeatureFlags
    ).mockImplementationOnce(
      () =>
        ({
          isEnabled: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
        }) as never
    );
    const preHandler = requireCapability('POS', FAKE_DB, FAKE_REDIS);
    const request = makeRequest({ tenantId: 1 });
    const reply = makeReply();

    await preHandler(request, reply, () => undefined);

    expect(reply.statusCode).toBe(503);
    expect(reply.body).toEqual({
      error: {
        code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
        message: 'Unable to determine capability state. Please retry.',
        details: { capabilityKey: 'POS' },
      },
    });
  });
});
