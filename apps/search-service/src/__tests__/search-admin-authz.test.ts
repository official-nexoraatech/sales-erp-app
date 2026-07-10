// ES-21 — search-service admin route tenant-trust fix (H1)
//
// Before this phase, /admin/search/reindex/:tenantId/:entity, /admin/search/indices/
// :tenantId, and /admin/search/stats/:tenantId/:entity trusted `tenantId` from the URL
// param — any caller with SEARCH_REINDEX could wipe or read another tenant's search
// index just by changing the path. The fix drops :tenantId from the path entirely and
// derives it exclusively from request.auth.tenantId (the verified JWT claim).

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { searchRoutes } from '../api/search.routes.js';

// Mocked the same way as the existing search-auth.test.ts: no real JWT key needed.
// The "token" is test-only JSON encoding the auth payload directly.
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

// See security.test.ts (auth-service) for why: vitest can resolve '@erp/types' to a
// stale compiled permissions.js missing constants added by later phases —
// SEARCH_REINDEX/SEARCH_GLOBAL included.
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      SEARCH_GLOBAL: 'SEARCH_GLOBAL',
      SEARCH_REINDEX: 'SEARCH_REINDEX',
    },
  };
});

function makeEngine(): SearchEngine {
  return {
    search: vi.fn(),
    fullReindex: vi.fn().mockResolvedValue({ indexed: 0 }),
    createTenantIndices: vi.fn().mockResolvedValue(undefined),
    deleteTenantIndices: vi.fn().mockResolvedValue(undefined),
    getIndexStats: vi.fn().mockResolvedValue({ docCount: 0 }),
    index: vi.fn(),
    delete: vi.fn(),
  } as unknown as SearchEngine;
}

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, email: 't@test.com', roles: [], ...auth })}`,
  };
}

describe('ES-21 — search-service admin route tenant-trust fix (H1)', () => {
  it('POST /admin/search/indices without SEARCH_REINDEX → 403', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/indices',
      headers: authHeader({ tenantId: 1, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    expect(engine.createTenantIndices).not.toHaveBeenCalled();
    await app.close();
  });

  it('creates indices only for the caller\'s own tenantId — there is no tenantId in the URL to override', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/search/indices',
      headers: authHeader({ tenantId: 2, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(201);
    expect(engine.createTenantIndices).toHaveBeenCalledWith(2);
    await app.close();
  });

  it('reindex and stats routes act on the tenantId from the JWT, never a client-supplied one', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const reindexRes = await app.inject({
      method: 'POST',
      url: '/admin/search/reindex/item',
      headers: authHeader({ tenantId: 5, permissions: ['SEARCH_REINDEX'] }),
    });
    expect(reindexRes.statusCode).toBe(200);
    expect(engine.fullReindex).toHaveBeenCalledWith(5, 'item', expect.any(Function));

    const statsRes = await app.inject({
      method: 'GET',
      url: '/admin/search/stats/item',
      headers: authHeader({ tenantId: 5, permissions: ['SEARCH_REINDEX'] }),
    });
    expect(statsRes.statusCode).toBe(200);
    expect(engine.getIndexStats).toHaveBeenCalledWith(5, 'item');

    await app.close();
  });

  it('DELETE /admin/search/indices removes only the caller\'s own tenant indices', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/search/indices',
      headers: authHeader({ tenantId: 7, permissions: ['SEARCH_REINDEX'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(engine.deleteTenantIndices).toHaveBeenCalledWith(7);
    await app.close();
  });
});
