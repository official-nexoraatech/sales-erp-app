// Notification-service audit 2026-07-23: template management API — the first tenant-facing way
// to create/edit/delete notification templates (previously only 4 hardcoded internal seed routes
// existed). Covers the two safety-critical behaviors: NOTIFICATION_CONFIG enforcement, and
// isSystem templates being locked against edit/delete so a tenant admin can't break password
// reset / welcome email.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { templateRoutes } from '../api/template.routes.js';

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
    PERMISSIONS: { ...actual.PERMISSIONS, NOTIFICATION_CONFIG: 'NOTIFICATION_CONFIG' },
  };
});

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, email: 't@test.com', roles: [], ...auth })}`,
  };
}

function buildDb(overrides: Partial<Record<string, unknown>> = {}): ErpDatabase {
  const db: Record<string, unknown> = {
    // withTenantConnection wraps every route in a transaction that sets the GUC via
    // `.execute()` before invoking the callback with this same object as the scoped db.
    execute: async () => undefined,
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
          then: undefined,
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    ...overrides,
  };
  db['transaction'] = (cb: (trx: unknown) => unknown) => cb(db);
  return db as unknown as ErpDatabase;
}

describe('template management routes — permission enforcement', () => {
  it('GET /notifications/templates without NOTIFICATION_CONFIG → 403', async () => {
    const app = Fastify({ logger: false });
    await templateRoutes(app, buildDb());

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/templates',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('POST /notifications/templates/preview', () => {
  it('renders Handlebars template with sample data, no persistence', async () => {
    const app = Fastify({ logger: false });
    await templateRoutes(app, buildDb());

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/templates/preview',
      headers: authHeader({ tenantId: 1, permissions: ['NOTIFICATION_CONFIG'] }),
      payload: { bodyTemplate: 'Hi {{name}}!', sampleData: { name: 'Raj' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { renderedBody: 'Hi Raj!', renderedSubject: undefined } });
    await app.close();
  });
});

describe('isSystem templates are locked against edit/delete', () => {
  function dbWithExistingRow(row: Record<string, unknown>): ErpDatabase {
    return buildDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([row]) }),
      }),
    });
  }

  it('PUT on an isSystem template → 400 SYSTEM_TEMPLATE_LOCKED, no update call made', async () => {
    const db = dbWithExistingRow({ id: 1, tenantId: 1, isSystem: true });
    const app = Fastify({ logger: false });
    await templateRoutes(app, db);

    const res = await app.inject({
      method: 'PUT',
      url: '/notifications/templates/1',
      headers: authHeader({ tenantId: 1, permissions: ['NOTIFICATION_CONFIG'] }),
      payload: { bodyTemplate: 'new body' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'SYSTEM_TEMPLATE_LOCKED' } });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('DELETE on an isSystem template → 400 SYSTEM_TEMPLATE_LOCKED, no delete call made', async () => {
    const db = dbWithExistingRow({ id: 1, tenantId: 1, isSystem: true });
    const app = Fastify({ logger: false });
    await templateRoutes(app, db);

    const res = await app.inject({
      method: 'DELETE',
      url: '/notifications/templates/1',
      headers: authHeader({ tenantId: 1, permissions: ['NOTIFICATION_CONFIG'] }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'SYSTEM_TEMPLATE_LOCKED' } });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('PUT on a non-system template updates normally', async () => {
    const db = dbWithExistingRow({ id: 2, tenantId: 1, isSystem: false });
    const app = Fastify({ logger: false });
    await templateRoutes(app, db);

    const res = await app.inject({
      method: 'PUT',
      url: '/notifications/templates/2',
      headers: authHeader({ tenantId: 1, permissions: ['NOTIFICATION_CONFIG'] }),
      payload: { bodyTemplate: 'new body' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe('POST /notifications/templates — duplicate (tenantId, eventType, channel) rejected', () => {
  it('returns 409 DUPLICATE_TEMPLATE instead of hitting the unique-constraint error', async () => {
    const db = buildDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 9 }]) }),
      }),
    });
    const app = Fastify({ logger: false });
    await templateRoutes(app, db);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/templates',
      headers: authHeader({ tenantId: 1, permissions: ['NOTIFICATION_CONFIG'] }),
      payload: {
        name: 'Dup',
        eventType: 'FOO',
        channel: 'EMAIL',
        bodyTemplate: 'body',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'DUPLICATE_TEMPLATE' } });
    expect(db.insert).not.toHaveBeenCalled();
    await app.close();
  });
});
