// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { exportScheduleRoutes } from '../api/export-schedule.routes.js';

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (
    request: { headers: { authorization?: string }; auth?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
      });
      return;
    }
    request.auth = JSON.parse(authHeader.slice(7)) as unknown;
  },
}));

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, ...auth })}` };
}

function makeFakeDb(opts: {
  insertReturn?: Record<string, unknown>;
  selectRows?: unknown[];
  updateReturn?: unknown[];
}) {
  const db: Record<string, unknown> = {
    // withTenantConnection wraps every route in a transaction that sets the GUC via
    // `.execute()` before invoking the callback with this same object as the scoped db.
    execute: async () => undefined,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(opts.insertReturn ? [opts.insertReturn] : []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(opts.updateReturn ?? []) })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve(opts.selectRows ?? [])),
          limit: vi.fn(() => Promise.resolve(opts.selectRows ?? [])),
        })),
      })),
    })),
  };
  db['transaction'] = (cb: (trx: unknown) => unknown) => cb(db);
  return db;
}

describe('POST /export-schedules', () => {
  it('403s a caller without EXPORT_GENERATE', async () => {
    const app = Fastify({ logger: false });
    await exportScheduleRoutes(app, makeFakeDb({}) as unknown as ErpDatabase);

    const res = await app.inject({
      method: 'POST',
      url: '/export-schedules',
      headers: authHeader({ tenantId: 1, permissions: [] }),
      payload: { entityType: 'lead', cronExpression: '0 6 * * *' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('creates a schedule for a caller with EXPORT_GENERATE', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({
      insertReturn: { id: 1, entityType: 'lead', cronExpression: '0 6 * * *' },
    });
    await exportScheduleRoutes(app, db as unknown as ErpDatabase);

    const res = await app.inject({
      method: 'POST',
      url: '/export-schedules',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_GENERATE'] }),
      payload: { entityType: 'lead', cronExpression: '0 6 * * *' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('rejects an unsupported entityType with a validation error, not a silent 500', async () => {
    const app = Fastify({ logger: false });
    await exportScheduleRoutes(app, makeFakeDb({}) as unknown as ErpDatabase);

    const res = await app.inject({
      method: 'POST',
      url: '/export-schedules',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_GENERATE'] }),
      payload: { entityType: 'not-a-real-entity', cronExpression: '0 6 * * *' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});

describe('GET /export-schedules', () => {
  it('403s a caller without EXPORT_VIEW', async () => {
    const app = Fastify({ logger: false });
    await exportScheduleRoutes(app, makeFakeDb({}) as unknown as ErpDatabase);

    const res = await app.inject({
      method: 'GET',
      url: '/export-schedules',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('200s and lists schedules for a caller with EXPORT_VIEW', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({ selectRows: [{ id: 1, entityType: 'lead' }] });
    await exportScheduleRoutes(app, db as unknown as ErpDatabase);

    const res = await app.inject({
      method: 'GET',
      url: '/export-schedules',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_VIEW'] }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.totalElements).toBe(1);
    await app.close();
  });
});

describe('DELETE /export-schedules/:id', () => {
  it('404s a schedule that does not belong to the caller tenant', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({ updateReturn: [] });
    await exportScheduleRoutes(app, db as unknown as ErpDatabase);

    const res = await app.inject({
      method: 'DELETE',
      url: '/export-schedules/999',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_GENERATE'] }),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
