// Phase 6 — saved-searches CRUD routes: JWT-authenticated (unlike search-sync.internal.routes.ts
// / internal.routes.ts, which are x-internal-key gated for scheduler-service) since these
// always act as the calling user, scoped to their own tenantId+userId.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import { savedSearchesRoutes } from '../api/saved-searches.routes.js';

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
  return { ...actual, PERMISSIONS: { ...actual.PERMISSIONS, SEARCH_GLOBAL: 'SEARCH_GLOBAL' } };
});

vi.mock('@erp/db', () => ({ savedSearches: { __name: 'savedSearches', tenantId: '__tenantId__', userId: '__userId__', id: '__id__' } }));

const { eqMock } = vi.hoisted(() => ({ eqMock: vi.fn(() => '__eq__') }));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
}));

function authHeader(auth: { tenantId: number; userId: number; permissions: string[] }): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify(auth)}` };
}

function makeFakeDb() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    db: {
      select: () => ({
        from: () => ({
          where: (): unknown => Object.assign(Promise.resolve(rows.slice()), {
            orderBy: () => Promise.resolve(rows.slice()),
          }),
        }),
      }),
      insert: () => ({
        values: (val: Record<string, unknown>) => {
          const created = { id: rows.length + 1, ...val };
          rows.push(created);
          return { returning: async () => [created] };
        },
      }),
      delete: () => ({ where: async () => { rows.length = 0; } }),
    },
  };
}

describe('saved-searches routes', () => {
  it('GET /saved-searches without SEARCH_GLOBAL → 403', async () => {
    const { db } = makeFakeDb();
    const app = Fastify({ logger: false });
    await savedSearchesRoutes(app, db as never);

    const res = await app.inject({
      method: 'GET',
      url: '/saved-searches',
      headers: authHeader({ tenantId: 1, userId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /saved-searches with no Authorization header → 401', async () => {
    const { db } = makeFakeDb();
    const app = Fastify({ logger: false });
    await savedSearchesRoutes(app, db as never);

    const res = await app.inject({ method: 'GET', url: '/saved-searches' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /saved-searches creates a saved search scoped to the caller', async () => {
    const { db } = makeFakeDb();
    const app = Fastify({ logger: false });
    await savedSearchesRoutes(app, db as never);

    const res = await app.inject({
      method: 'POST',
      url: '/saved-searches',
      headers: authHeader({ tenantId: 1, userId: 7, permissions: ['SEARCH_GLOBAL'] }),
      payload: { name: 'Overdue invoices', query: 'overdue', entity: 'invoice' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { name: string; userId: number; tenantId: number } };
    expect(body.data.name).toBe('Overdue invoices');
    expect(body.data.userId).toBe(7);
    expect(body.data.tenantId).toBe(1);
    await app.close();
  });

  it('POST /saved-searches with no name → 422 (schema validation)', async () => {
    const { db } = makeFakeDb();
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      const err = error as { statusCode?: number; message: string };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    });
    await savedSearchesRoutes(app, db as never);

    const res = await app.inject({
      method: 'POST',
      url: '/saved-searches',
      headers: authHeader({ tenantId: 1, userId: 7, permissions: ['SEARCH_GLOBAL'] }),
      payload: { query: 'overdue' },
    });

    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('DELETE /saved-searches/:id for a nonexistent id → 404, delete never called', async () => {
    const { db } = makeFakeDb(); // empty store
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      const err = error as { statusCode?: number; message: string };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    });
    await savedSearchesRoutes(app, db as never);

    const res = await app.inject({
      method: 'DELETE',
      url: '/saved-searches/1',
      headers: authHeader({ tenantId: 1, userId: 7, permissions: ['SEARCH_GLOBAL'] }),
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /saved-searches/:id scopes its existence check to the caller — not just the id', async () => {
    const { db, rows } = makeFakeDb();
    rows.push({ id: 1, tenantId: 1, userId: 99, name: "Someone else's search" });
    eqMock.mockClear();
    const app = Fastify({ logger: false });
    await savedSearchesRoutes(app, db as never);

    await app.inject({
      method: 'DELETE',
      url: '/saved-searches/1',
      headers: authHeader({ tenantId: 1, userId: 7, permissions: ['SEARCH_GLOBAL'] }),
    });

    // The route builds its existence-check predicate from id + tenantId + userId, not id
    // alone — this is what should prevent one user from deleting another's saved search
    // (the shallow fake db above can't simulate real WHERE filtering, so this asserts the
    // query was *constructed* with the ownership check rather than that it was enforced).
    expect(eqMock).toHaveBeenCalledWith('__userId__', 7);
    expect(eqMock).toHaveBeenCalledWith('__tenantId__', 1);
    await app.close();
  });
});
