// CP-9 follow-up (R14): integration test proving the per-tenant configurable notification rate
// limit actually changes /notifications/send-raw-internal's behavior — a tenant with a
// configured higher limit must NOT be throttled at a volume that WOULD throttle a tenant left on
// the platform default (200/min).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { tenantOrIpKeyGenerator } from '@erp/sdk';
import type Redis from 'ioredis';
import type { ErpDatabase } from '@erp/db';
import type { NotificationServiceConfig } from '../config.js';

vi.mock('@erp/db', () => ({
  notificationLog: new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) }),
  notificationPreferences: new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) }),
  notificationTemplates: new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) }),
  tenantCommunicationSettings: new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
  desc: vi.fn((_a: unknown) => '__desc__'),
}));

const sendRawMock = vi.fn().mockResolvedValue({ status: 'SENT', logId: 1 });
vi.mock('../domain/NotificationEngine.js', () => ({
  NotificationEngine: vi.fn().mockImplementation(() => ({ sendRaw: sendRawMock })),
}));

import { notificationRoutes } from '../api/notification.routes.js';

const INTERNAL_KEY = 'test-internal-key';

function makeDb(settingsRows: Array<{ limit: number | null }>): ErpDatabase {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(settingsRows)),
      })),
    })),
  } as unknown as ErpDatabase;
}

function makeRedis(incrValue: number): Redis {
  return {
    incr: vi.fn(async () => incrValue),
    expire: vi.fn(async () => 1),
  } as unknown as Redis;
}

async function buildApp(db: ErpDatabase, redis: Redis) {
  const app = Fastify({ logger: false });
  await notificationRoutes(app, db, {} as NotificationServiceConfig, redis);
  return app;
}

describe('POST /notifications/send-raw-internal — per-tenant rate limit', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = INTERNAL_KEY;
    sendRawMock.mockClear();
  });

  it('rejects with 429 when a tenant left on the platform default (200/min) exceeds it', async () => {
    const db = makeDb([]); // no configured override -> falls back to default 200
    const redis = makeRedis(201); // this request is the 201st in the current window
    const app = await buildApp(db, redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/send-raw-internal',
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { tenantId: 1, channel: 'SMS', body: 'hello' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('TENANT_RATE_LIMIT_EXCEEDED');
    expect(sendRawMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('does NOT throttle a tenant configured with a higher limit at the same volume', async () => {
    const db = makeDb([{ limit: 1000 }]); // tenant-specific override
    const redis = makeRedis(201); // same 201st-request volume that throttled the default tenant
    const app = await buildApp(db, redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/send-raw-internal',
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { tenantId: 2, channel: 'SMS', body: 'hello' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendRawMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('allows a default-limit tenant within its budget', async () => {
    const db = makeDb([]);
    const redis = makeRedis(50);
    const app = await buildApp(db, redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/send-raw-internal',
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { tenantId: 1, channel: 'SMS', body: 'hello' },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects with 401 when the internal key is missing or wrong, before touching the rate limiter', async () => {
    const db = makeDb([]);
    const redis = makeRedis(1);
    const app = await buildApp(db, redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/send-raw-internal',
      headers: { 'x-internal-key': 'wrong-key' },
      payload: { tenantId: 1, channel: 'SMS', body: 'hello' },
    });

    expect(res.statusCode).toBe(401);
    expect(sendRawMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /notifications/send-raw-internal — exempt from the global IP-keyed rate limiter', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = INTERNAL_KEY;
    sendRawMock.mockClear();
  });

  // Regression test for the real bug this session found: main.ts registers a global,
  // IP-keyed @fastify/rate-limit plugin (request.auth is never populated on this internal-key
  // route, so tenantOrIpKeyGenerator falls back to IP) that would otherwise cap ALL tenants'
  // campaign sends combined at whatever the global max is, silently shadowing the per-tenant
  // Redis check below it — reintroducing R14 even with a correct per-tenant limit configured.
  it('is not throttled by a low global IP-keyed limit that a sibling route WOULD hit', async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimit, {
      global: true,
      max: 3,
      timeWindow: '1 minute',
      keyGenerator: tenantOrIpKeyGenerator,
    });
    // A plain route with no rateLimit exemption, to prove the global plugin is actually active.
    app.get('/other-route', async () => ({ ok: true }));

    const db = makeDb([]);
    const redis = makeRedis(1); // always well within the tenant-level limit
    await notificationRoutes(app, db, {} as NotificationServiceConfig, redis);

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/other-route' });
      expect(res.statusCode).toBe(200);
    }
    const throttled = await app.inject({ method: 'GET', url: '/other-route' });
    expect(throttled.statusCode).toBe(429);

    // send-raw-internal must still succeed even though the same-IP global budget is exhausted.
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/send-raw-internal',
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { tenantId: 1, channel: 'SMS', body: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(sendRawMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
