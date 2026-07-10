// ES-33 — POST /search/index and DELETE /search/index/:entity/:id only checked
// `authenticate` (any valid JWT in the tenant), with no permission check at all — any
// authenticated user of a tenant could index or delete arbitrary search documents. Fixed
// by requiring SEARCH_REINDEX, the same permission already used for the other
// index-management routes in this file.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { searchRoutes } from '../api/search.routes.js';

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
  return {
    ...actual,
    PERMISSIONS: { ...actual.PERMISSIONS, SEARCH_REINDEX: 'SEARCH_REINDEX', SEARCH_GLOBAL: 'SEARCH_GLOBAL' },
  };
});

function makeEngine(): SearchEngine {
  return {
    search: vi.fn(),
    fullReindex: vi.fn(),
    createTenantIndices: vi.fn(),
    deleteTenantIndices: vi.fn(),
    getIndexStats: vi.fn(),
    index: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as SearchEngine;
}

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, email: 't@test.com', roles: [], ...auth })}`,
  };
}

describe('ES-33 — search index mutation routes require SEARCH_REINDEX', () => {
  it('POST /search/index without SEARCH_REINDEX → 403', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'POST',
      url: '/search/index',
      headers: authHeader({ tenantId: 1, permissions: [] }),
      payload: { entity: 'customer', id: '1', document: {} },
    });

    expect(res.statusCode).toBe(403);
    expect(engine.index).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /search/index with SEARCH_REINDEX → 200', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'POST',
      url: '/search/index',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_REINDEX'] }),
      payload: { entity: 'customer', id: '1', document: {} },
    });

    expect(res.statusCode).toBe(200);
    expect(engine.index).toHaveBeenCalledWith(1, 'customer', '1', {});
    await app.close();
  });

  it('DELETE /search/index/:entity/:id without SEARCH_REINDEX → 403', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'DELETE',
      url: '/search/index/customer/1',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    expect(engine.delete).not.toHaveBeenCalled();
    await app.close();
  });
});
