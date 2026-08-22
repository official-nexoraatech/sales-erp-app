// Notification-service audit 2026-07-23: retry endpoints for FAILED notifications.
// POST /notifications/:id/retry mirrors the IDOR-prevention pattern already established for
// /notifications/:id/read (scoped by tenantId) and requires NOTIFICATION_SEND, same as
// POST /notifications/send. POST /notifications/retry-failed-internal is x-internal-key gated,
// same convention as every other *-internal route in this service.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type Redis from 'ioredis';
import type * as ErpTypes from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import type { DeliveryEnqueuer } from '../domain/DeliveryQueue.js';
import { notificationRoutes } from '../api/notification.routes.js';

function mockQueue(): DeliveryEnqueuer {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (
    request: { headers: { authorization?: string }; auth?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    request.auth = JSON.parse(authHeader.slice(7)) as unknown;
  },
  authenticateStream: async (): Promise<void> => {},
}));

vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: { ...actual.PERMISSIONS, NOTIFICATION_SEND: 'NOTIFICATION_SEND' },
  };
});

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, email: 't@test.com', roles: [], ...auth })}`,
  };
}

function emptyDb(): ErpDatabase {
  const db: Record<string, unknown> = {
    // withTenantConnection wraps every route in a transaction that sets the GUC via
    // `.execute()` before invoking the callback with this same object as the scoped db.
    execute: async () => undefined,
    select: vi
      .fn()
      .mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  };
  db['transaction'] = (cb: (trx: unknown) => unknown) => cb(db);
  return db as unknown as ErpDatabase;
}

describe('POST /notifications/:id/retry', () => {
  it('requires NOTIFICATION_SEND → 403 without it', async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, emptyDb(), mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/1/retry',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 rather than another tenant's row when none exists for this tenant (IDOR-safe)", async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, emptyDb(), mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/999/retry',
      headers: authHeader({ tenantId: 1, permissions: ['NOTIFICATION_SEND'] }),
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /notifications/retry-failed-internal', () => {
  it('rejects requests with no x-internal-key header with 401', async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, emptyDb(), mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/retry-failed-internal?tenantId=1',
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a correct x-internal-key and runs the retry sweep', async () => {
    process.env['INTERNAL_API_KEY'] = 'test-internal-key';
    const app = Fastify({ logger: false });
    await notificationRoutes(app, emptyDb(), mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/retry-failed-internal?tenantId=1',
      headers: { 'x-internal-key': 'test-internal-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { requeued: 0 } });
    await app.close();
    delete process.env['INTERNAL_API_KEY'];
  });
});
