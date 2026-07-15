// ES-20 — Admin route guard tests: VIEW_AUDIT_LOG / FEATURE_FLAG_VIEW / FEATURE_FLAG_UPDATE

import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type * as ErpTypes from '@erp/types';

vi.mock('@erp/db', () => ({
  auditLog: { __name: 'audit_log' },
  featureFlags: { __name: 'feature_flags' },
}));

// packages/shared-types/src/ has a stale compiled permissions.js sitting next to
// permissions.ts (build artifact left in src/ instead of dist/) that vitest's
// `@erp/types` alias picks up instead of the real source, so newer PERMISSIONS
// keys (VIEW_AUDIT_LOG, FEATURE_FLAG_VIEW/UPDATE) resolve to undefined under
// vitest even though the real compiled dist used at runtime is fine. Same class
// of issue as the documented @erp/db barrel-export quirk — worked around the
// same way, by overriding just PERMISSIONS via importOriginal, which keeps every
// other real export (ERPError, BusinessError, etc.) intact — feature-flags.routes.ts
// pulls in @erp/sdk's idempotency.ts transitively, which needs a real ERPError class.
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
      FEATURE_FLAG_VIEW: 'FEATURE_FLAG_VIEW',
      FEATURE_FLAG_UPDATE: 'FEATURE_FLAG_UPDATE',
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ type: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
  isNull: vi.fn((a: unknown) => ({ type: 'isNull', a })),
  gte: vi.fn((a: unknown, b: unknown) => ({ type: 'gte', a, b })),
  lte: vi.fn((a: unknown, b: unknown) => ({ type: 'lte', a, b })),
  desc: vi.fn((a: unknown) => a),
  count: vi.fn(() => 'count()'),
}));

import { auditLogRoutes } from '../routes/audit-log.routes.js';
import { featureFlagsRoutes } from '../routes/feature-flags.routes.js';

function withAuth(permissions: string[]) {
  return async (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: unknown }).auth = { tenantId: 1, userId: 1, permissions };
  };
}

function makeRedis() {
  return {
    del: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn().mockReturnThis(),
  };
}

function chainable(result: unknown[]) {
  const p: Record<string, unknown> = {};
  const self = () => Object.assign(Promise.resolve(result), p);
  p['where'] = vi.fn().mockImplementation(self);
  p['orderBy'] = vi.fn().mockImplementation(self);
  p['limit'] = vi.fn().mockImplementation(self);
  p['offset'] = vi.fn().mockResolvedValue(result);
  return p;
}

async function buildApp(
  permissions: string[],
  db: Record<string, unknown>,
  redis: Record<string, unknown> = makeRedis()
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', withAuth(permissions));
  await auditLogRoutes(app, db as never);
  await featureFlagsRoutes(app, db as never, redis as never);
  return app;
}

describe('ES-20 — admin route permission guards', () => {
  it('GET /admin/audit-logs without VIEW_AUDIT_LOG → 403', async () => {
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chainable([])) }),
    };
    const app = await buildApp([], db);

    const res = await app.inject({ method: 'GET', url: '/admin/audit-logs' });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /admin/audit-logs with VIEW_AUDIT_LOG → 200 with paginated content', async () => {
    const rows = [{ id: 1, entityType: 'invoice', action: 'CREATE' }];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue(chainable(rows)) })
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue(chainable([{ total: 1 }])) }),
    };
    const app = await buildApp(['VIEW_AUDIT_LOG'], db);

    const res = await app.inject({ method: 'GET', url: '/admin/audit-logs' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { content: unknown[]; totalElements: number } };
    expect(body.data.content).toEqual(rows);
    await app.close();
  });

  it('PUT /admin/feature-flags/:name without FEATURE_FLAG_UPDATE → 403', async () => {
    const db = { select: vi.fn(), update: vi.fn(), insert: vi.fn() };
    const app = await buildApp(['FEATURE_FLAG_VIEW'], db);

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/feature-flags/einvoice_enabled',
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PUT /admin/feature-flags/:name with FEATURE_FLAG_UPDATE inserts a tenant override and invalidates the cache', async () => {
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chainable([])) }), // no existing override
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    };
    const redis = makeRedis();
    const app = await buildApp(['FEATURE_FLAG_UPDATE'], db, redis);

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/feature-flags/einvoice_enabled',
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(db.insert).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
    expect(redis.publish).toHaveBeenCalled();
    await app.close();
  });
});
