// Phase 6 — advanced search filters (status/branchId/warehouseId/customerId/supplierId,
// date range). Verifies GET /search parses these query params into the right
// SearchEngine.search() call shape.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '@erp/sdk';
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
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      SEARCH_GLOBAL: 'SEARCH_GLOBAL',
      INVOICE_VIEW: 'INVOICE_VIEW',
    },
  };
});

function makeEngine(): SearchEngine {
  return {
    search: vi.fn().mockResolvedValue({ hits: [], total: 0, took: 1 }),
  } as unknown as SearchEngine;
}

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, email: 't@test.com', roles: [], branchIds: [], ...auth })}`,
  };
}

describe('GET /search — advanced filters (Phase 6)', () => {
  it('folds status/branchId/warehouseId/customerId/supplierId into engine.search filters', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    await app.inject({
      method: 'GET',
      url: '/search?q=test&entity=invoice&status=OVERDUE&branchId=3&customerId=42',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'] }),
    });

    expect(engine.search).toHaveBeenCalledWith(
      1,
      'test',
      expect.objectContaining({
        entity: 'invoice',
        filters: { status: 'OVERDUE', branchId: '3', customerId: 42 },
      })
    );
    await app.close();
  });

  it('passes dateField/dateFrom/dateTo as a dateRange clause, not a filters entry', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    await app.inject({
      method: 'GET',
      url: '/search?q=test&entity=invoice&dateField=invoiceDate&dateFrom=2026-01-01&dateTo=2026-01-31',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'] }),
    });

    expect(engine.search).toHaveBeenCalledWith(
      1,
      'test',
      expect.objectContaining({
        dateRange: { field: 'invoiceDate', from: '2026-01-01', to: '2026-01-31' },
      })
    );
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[2] as { filters?: unknown }).filters).toBeUndefined();
    await app.close();
  });

  it('omits filters/dateRange entirely when no advanced params are given', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    await app.inject({
      method: 'GET',
      url: '/search?q=test&entity=invoice',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'] }),
    });

    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[2] as { filters?: unknown; dateRange?: unknown };
    expect(opts.filters).toBeUndefined();
    expect(opts.dateRange).toBeUndefined();
    await app.close();
  });

  // Regression: `from` had no upper bound, so a caller paging past result 10,000 (a real
  // scenario at ERP scale — browsing an unfiltered list of millions of invoices) hit
  // Elasticsearch's default `index.max_result_window` and got its raw
  // illegal_argument_exception bubbling up as an opaque 500 instead of a clean 400. Found
  // live against a real ES 8.17 cluster 2026-07-19.
  it('rejects from beyond 9900 (ES max_result_window headroom) with 400, never reaching engine.search', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    // Zod's .parse() throws on an out-of-range `from` — production only turns that into a
    // clean 400 via the shared error handler (registered before routes, same as main.ts),
    // so this test wires it up too rather than asserting against Fastify's bare default 500.
    registerErrorHandler(app, 'search-service', { error: () => {} });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=test&entity=invoice&from=20000',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'] }),
    });

    expect(res.statusCode).toBe(400);
    expect(engine.search).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts from at the 9900 boundary', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=test&entity=invoice&from=9900',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(engine.search).toHaveBeenCalled();
    await app.close();
  });
});
