// ES-33 — POST /notifications/send only checked `authenticate` (any valid JWT in the
// tenant), even though NOTIFICATION_SEND already existed as a permission constant and was
// never wired to this route — any authenticated user could send a notification to any
// recipient. Fixed by adding requirePermission(NOTIFICATION_SEND).
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import type { NotificationServiceConfig } from '../config.js';
import { notificationRoutes } from '../api/notification.routes.js';

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

describe('ES-33 — POST /notifications/send requires NOTIFICATION_SEND', () => {
  it('authenticated but missing NOTIFICATION_SEND → 403', async () => {
    const app = Fastify({ logger: false });
    await notificationRoutes(app, {} as ErpDatabase, {} as NotificationServiceConfig);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/send',
      headers: authHeader({ tenantId: 1, permissions: [] }),
      payload: { eventType: 'TEST', templateData: {} },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
