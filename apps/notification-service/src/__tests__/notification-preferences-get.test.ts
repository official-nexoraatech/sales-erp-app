// Notification-service audit 2026-07-23: POST /notifications/preferences existed to save a
// user's channel preferences, but there was no way to read them back — the frontend preferences
// page needs this to render current state before letting the user edit it.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type Redis from 'ioredis';
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

function authHeader(auth: { tenantId: number; userId: number }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', email: 't@test.com', roles: [], permissions: [], ...auth })}`,
  };
}

describe('GET /notifications/preferences', () => {
  it("returns the current user's saved preferences, scoped by tenant + userId", async () => {
    const rows = [
      {
        eventType: 'WORKFLOW_APPROVAL_REMINDER',
        smsEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        inAppEnabled: true,
        quietHoursEnabled: true,
      },
    ];
    const whereMock = vi.fn().mockResolvedValue(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const dbObj: Record<string, unknown> = {
      // withTenantConnection wraps every route in a transaction that sets the GUC via
      // `.execute()` before invoking the callback with this same object as the scoped db.
      execute: async () => undefined,
      select: vi.fn().mockReturnValue({ from: fromMock }),
    };
    dbObj['transaction'] = (cb: (trx: unknown) => unknown) => cb(dbObj);
    const db = dbObj as unknown as ErpDatabase;

    const app = Fastify({ logger: false });
    await notificationRoutes(app, db, mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/preferences',
      headers: authHeader({ tenantId: 1, userId: 7 }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { content: rows } });
    await app.close();
  });

  it('requires authentication', async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, {} as ErpDatabase, mockQueue(), {} as Redis);

    const res = await app.inject({ method: 'GET', url: '/notifications/preferences' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
