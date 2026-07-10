// Phase 8 — search analytics: click-through tracking and the admin summary view.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import { searchAnalyticsRoutes } from '../api/search-analytics.routes.js';

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
}));

vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return { ...actual, PERMISSIONS: { ...actual.PERMISSIONS, SEARCH_GLOBAL: 'SEARCH_GLOBAL', SEARCH_REINDEX: 'SEARCH_REINDEX' } };
});

vi.mock('@erp/db', () => ({
  searchAnalytics: {
    __name: 'searchAnalytics', id: 'id', tenantId: 'tenantId', userId: 'userId', query: 'query',
    clickedResultId: 'clickedResultId', clickedEntity: 'clickedEntity', createdAt: 'createdAt', resultCount: 'resultCount', latencyMs: 'latencyMs',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  gte: vi.fn(() => '__gte__'),
  isNull: vi.fn(() => '__isNull__'),
  sql: Object.assign(vi.fn(() => '__sql__'), { raw: vi.fn() }),
}));

function authHeader(auth: { tenantId: number; userId?: number; permissions: string[] }): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify(auth)}` };
}

describe('POST /search/analytics/click', () => {
  it('without SEARCH_GLOBAL → 403', async () => {
    const db = { select: vi.fn(), update: vi.fn() };
    const app = Fastify({ logger: false });
    await searchAnalyticsRoutes(app, db as never);

    const res = await app.inject({
      method: 'POST',
      url: '/search/analytics/click',
      headers: authHeader({ tenantId: 1, userId: 1, permissions: [] }),
      payload: { query: 'ramesh', resultId: '7', resultEntity: 'customer' },
    });

    expect(res.statusCode).toBe(403);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('with a matching recent search event, updates it and reports recorded:true', async () => {
    const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: 42 }]) }) }) }) }),
      update: () => ({ set: setMock }),
    };
    const app = Fastify({ logger: false });
    await searchAnalyticsRoutes(app, db as never);

    const res = await app.inject({
      method: 'POST',
      url: '/search/analytics/click',
      headers: authHeader({ tenantId: 1, userId: 1, permissions: ['SEARCH_GLOBAL'] }),
      payload: { query: 'ramesh', resultId: '7', resultEntity: 'customer' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
    expect(setMock).toHaveBeenCalledWith({ clickedResultId: '7', clickedEntity: 'customer' });
  });

  it('with no matching recent search event, reports recorded:false and never updates', async () => {
    const updateMock = vi.fn();
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
      update: updateMock,
    };
    const app = Fastify({ logger: false });
    await searchAnalyticsRoutes(app, db as never);

    const res = await app.inject({
      method: 'POST',
      url: '/search/analytics/click',
      headers: authHeader({ tenantId: 1, userId: 1, permissions: ['SEARCH_GLOBAL'] }),
      payload: { query: 'ramesh', resultId: '7', resultEntity: 'customer' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('GET /admin/search/analytics/summary', () => {
  it('without SEARCH_REINDEX → 403', async () => {
    const db = { select: vi.fn() };
    const app = Fastify({ logger: false });
    await searchAnalyticsRoutes(app, db as never);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/search/analytics/summary',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('with SEARCH_REINDEX returns totals + popular/no-result query breakdowns', async () => {
    const totalsRow = { totalSearches: 10, noResultCount: 2, clickedCount: 5, avgLatencyMs: 42 };
    const popularRows = [{ query: 'ramesh', count: 4 }];
    const noResultRows = [{ query: 'zzz', count: 2 }];
    let selectCallIndex = 0;
    const db = {
      select: () => {
        selectCallIndex += 1;
        if (selectCallIndex === 1) {
          return { from: () => ({ where: () => Promise.resolve([totalsRow]) }) };
        }
        const rows = selectCallIndex === 2 ? popularRows : noResultRows;
        return { from: () => ({ where: () => ({ groupBy: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }) }) };
      },
    };
    const app = Fastify({ logger: false });
    await searchAnalyticsRoutes(app, db as never);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/search/analytics/summary?days=7',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: typeof totalsRow & { popularQueries: unknown; noResultQueries: unknown } };
    expect(body.data.totalSearches).toBe(10);
    expect(body.data.popularQueries).toEqual(popularRows);
    expect(body.data.noResultQueries).toEqual(noResultRows);
  });
});
