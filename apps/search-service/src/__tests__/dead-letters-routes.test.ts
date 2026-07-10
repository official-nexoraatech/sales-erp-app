// Phase 8 — dead-letter admin routes: list/retry/discard for search-service's own
// consume-side failures in the shared dlq_items table.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { deadLettersRoutes } from '../api/dead-letters.routes.js';

const syncSearchIndexMock = vi.fn();

vi.mock('../consumers/SearchSyncConsumer.js', () => ({
  syncSearchIndex: (...args: unknown[]) => syncSearchIndexMock(...args),
}));

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
  return { ...actual, PERMISSIONS: { ...actual.PERMISSIONS, SEARCH_REINDEX: 'SEARCH_REINDEX' } };
});

vi.mock('@erp/db', () => ({
  dlqItems: { __name: 'dlqItems', id: 'id', tenantId: 'tenantId', status: 'status', createdAt: 'createdAt', headers: 'headers' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  sql: vi.fn(() => '__sql__'),
  count: vi.fn(() => '__count__'),
}));

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify(auth)}` };
}

function makeEngine(): SearchEngine {
  return {} as unknown as SearchEngine;
}

describe('GET /admin/search/dead-letters', () => {
  it('without SEARCH_REINDEX → 403', async () => {
    const db = { select: vi.fn() };
    const app = Fastify({ logger: false });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'GET',
      url: '/admin/search/dead-letters',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('with SEARCH_REINDEX lists PENDING items scoped to the caller tenant', async () => {
    const rows = [{ id: 1, topic: 'erp.customer.created', status: 'PENDING' }];
    const db = {
      select: (arg?: unknown) =>
        arg
          ? { from: () => ({ where: () => Promise.resolve([{ total: rows.length }]) }) }
          : { from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(rows) }) }) }) }) },
    };
    const app = Fastify({ logger: false });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'GET',
      url: '/admin/search/dead-letters',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { content: unknown[] } };
    expect(body.data.content).toEqual(rows);
  });
});

describe('POST /admin/search/dead-letters/:id/retry', () => {
  beforeEach(() => { syncSearchIndexMock.mockReset(); });

  it('retrying a nonexistent id → 404', async () => {
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      const err = error as { statusCode?: number; message: string };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/dead-letters/1/retry',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('retrying an item whose status is not PENDING → 409-style business error', async () => {
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1, status: 'REPLAYED', retryCount: 0, payload: {} }]) }) }) };
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      const err = error as { statusCode?: number; message: string };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/dead-letters/1/retry',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(422);
    expect(syncSearchIndexMock).not.toHaveBeenCalled();
  });

  it('a successful retry re-syncs the index and marks the item REPLAYED', async () => {
    syncSearchIndexMock.mockResolvedValueOnce(undefined);
    const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1, status: 'PENDING', retryCount: 0, payload: { eventType: 'CUSTOMER_CREATED' } }]) }) }),
      update: () => ({ set: setMock }),
    };
    const app = Fastify({ logger: false });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/dead-letters/1/retry',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(syncSearchIndexMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'REPLAYED' }));
  });

  it('a failed retry increments retryCount and returns 502, without marking it resolved', async () => {
    syncSearchIndexMock.mockRejectedValueOnce(new Error('ES unavailable'));
    const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1, status: 'PENDING', retryCount: 2, payload: { eventType: 'CUSTOMER_CREATED' } }]) }) }),
      update: () => ({ set: setMock }),
    };
    const app = Fastify({ logger: false });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/dead-letters/1/retry',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(502);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 3 }));
  });
});

describe('POST /admin/search/dead-letters/:id/discard', () => {
  it('marks an item DISCARDED', async () => {
    const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1, status: 'PENDING' }]) }) }),
      update: () => ({ set: setMock }),
    };
    const app = Fastify({ logger: false });
    await deadLettersRoutes(app, db as never, makeEngine());

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/dead-letters/1/discard',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(setMock).toHaveBeenCalledWith({ status: 'DISCARDED' });
  });
});
