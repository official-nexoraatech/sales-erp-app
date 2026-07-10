// ES-33 — scheduler-service had no `authenticate` middleware wired anywhere (no
// middleware/ directory existed), yet scheduler.routes.ts/export.routes.ts/import.routes.ts
// all gated on a local hasPermission(request, perm) reading request.auth.permissions.
// Since request.auth was never populated, every one of these routes was unconditionally
// 403 for every caller — the feature was entirely unusable. Fixed by adding the standard
// authenticate middleware (same pattern as every sibling service) as a preHandler on each
// route, so authenticated+permissioned callers now actually get through.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { ErpDatabase } from '@erp/db';
import type { JobRegistry } from '../JobRegistry.js';
import { schedulerRoutes } from '../api/scheduler.routes.js';

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (
    request: { headers: { authorization?: string }; auth?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } });
      return;
    }
    request.auth = JSON.parse(authHeader.slice(7)) as unknown;
  },
}));

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, email: 't@test.com', roles: [], ...auth })}`,
  };
}

function makeFakeRegistry(): JobRegistry {
  return { listAll: () => [] } as unknown as JobRegistry;
}

describe('ES-33 — GET /jobs now actually enforces auth (previously always 403, feature unusable)', () => {
  it('no Authorization header → 401 (authenticate rejects before the permission check runs)', async () => {
    const app = Fastify({ logger: false });
    await schedulerRoutes(app, {} as ErpDatabase, makeFakeRegistry());

    const res = await app.inject({ method: 'GET', url: '/jobs' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('valid JWT without JOB_VIEW → 403', async () => {
    const app = Fastify({ logger: false });
    await schedulerRoutes(app, {} as ErpDatabase, makeFakeRegistry());

    const res = await app.inject({
      method: 'GET',
      url: '/jobs',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('valid JWT with JOB_VIEW → 200 with job list', async () => {
    const app = Fastify({ logger: false });
    await schedulerRoutes(app, {} as ErpDatabase, makeFakeRegistry());

    const res = await app.inject({
      method: 'GET',
      url: '/jobs',
      headers: authHeader({ tenantId: 1, permissions: ['JOB_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: { content: [], totalElements: 0 } });
    await app.close();
  });
});
