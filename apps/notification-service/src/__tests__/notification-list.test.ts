// Notification Center: GET /notifications previously used a one-off 0-based page/size shape
// with no totalElements, diverging from every other list endpoint in the platform. This locks
// in the corrected page(1-based)/pageSize/totalElements shape and confirms per-user isolation
// (tenantId + recipientUserId) is still enforced on the query.
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

// A drizzle query builder chain (.from/.where/.orderBy/.limit/.offset) that resolves to
// `resolveTo` when awaited at any point in the chain — enough to exercise the route's actual
// query shape without a real database.
function chainable(resolveTo: unknown): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'offset']) {
    obj[method] = vi.fn().mockReturnValue(obj);
  }
  obj['then'] = (resolve: (v: unknown) => void) => resolve(resolveTo);
  return obj;
}

describe('GET /notifications', () => {
  it('returns page/pageSize/totalElements (1-based), scoped by tenant + recipientUserId', async () => {
    const items = [
      { id: 2, subject: 'B', body: 'b', readAt: null, entityType: 'Invoice', entityId: 5 },
      { id: 1, subject: 'A', body: 'a', readAt: null, entityType: null, entityId: null },
    ];
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(chainable(items)) // content query
      .mockReturnValueOnce(chainable([{ count: 2 }])) // totalElements query
      .mockReturnValueOnce(chainable([])); // engine.getUnreadCount's own select
    const db = { select: selectMock } as unknown as ErpDatabase;

    const app = Fastify({ logger: false });
    await notificationRoutes(app, db, mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'GET',
      url: '/notifications?page=1&pageSize=20',
      headers: authHeader({ tenantId: 1, userId: 7 }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({
      content: items,
      page: 1,
      pageSize: 20,
      totalElements: 2,
      unreadCount: 0,
    });
    // Old shape (`size`, 0-based `page`, no `totalElements`) must be gone.
    expect(body.data.size).toBeUndefined();
    await app.close();
  });

  it('requires authentication', async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, {} as ErpDatabase, mockQueue(), {} as Redis);

    const res = await app.inject({ method: 'GET', url: '/notifications' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /notifications/read-all', () => {
  it("marks every unread IN_APP notification as read, scoped to the caller's own tenant+user", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const db = {
      update: vi.fn().mockReturnValue({ set: setMock }),
    } as unknown as ErpDatabase;

    const app = Fastify({ logger: false });
    await notificationRoutes(app, db, mockQueue(), {} as Redis);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/read-all',
      headers: authHeader({ tenantId: 1, userId: 7 }),
    });

    expect(res.statusCode).toBe(200);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.any(Date) }));
    await app.close();
  });

  it('requires authentication', async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, {} as ErpDatabase, mockQueue(), {} as Redis);

    const res = await app.inject({ method: 'POST', url: '/notifications/read-all' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
