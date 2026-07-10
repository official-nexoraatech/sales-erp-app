// Global Search Phase 1 — per-entity permission gating and branch-scope filtering.
//
// Before this phase, GET /search only checked the blanket SEARCH_GLOBAL permission — any
// authenticated user holding it could request `entity=employee` (or any other entity) and
// see results regardless of whether they held EMPLOYEE_VIEW, and branch-restricted users
// could see other branches' invoices/quotations/etc. in search results. This verifies the
// fix: a specific `entity` is checked against its required permission, an untyped global
// search is silently filtered down to only entities the caller can view, and branch-scoped
// entities are filtered by the caller's branchIds (or excluded from global search entirely
// when branch-restricted, per the SearchEngine.ts BRANCH_SCOPED_ENTITIES comment).
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
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      SEARCH_GLOBAL: 'SEARCH_GLOBAL',
      SEARCH_REINDEX: 'SEARCH_REINDEX',
    },
  };
});

function makeEngine(): SearchEngine {
  return {
    search: vi.fn().mockResolvedValue({ hits: [], total: 0, took: 1 }),
    fullReindex: vi.fn(),
    createTenantIndices: vi.fn(),
    deleteTenantIndices: vi.fn(),
    getIndexStats: vi.fn(),
    index: vi.fn(),
    delete: vi.fn(),
  } as unknown as SearchEngine;
}

function authHeader(auth: { tenantId: number; permissions: string[]; branchIds?: number[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({
      sub: '1',
      userId: 1,
      email: 't@test.com',
      roles: [],
      branchIds: [],
      ...auth,
    })}`,
  };
}

describe('Global Search Phase 1 — entity permission gating', () => {
  it('GET /search?entity=employee without EMPLOYEE_VIEW → 403, engine never called', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=john&entity=employee',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL'] }),
    });

    expect(res.statusCode).toBe(403);
    expect(engine.search).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /search?entity=employee with EMPLOYEE_VIEW → 200, searches only that entity', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=john&entity=employee',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'EMPLOYEE_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(engine.search).toHaveBeenCalledWith(
      1,
      'john',
      expect.objectContaining({ entity: 'employee' })
    );
    await app.close();
  });

  it('untyped global search is restricted to entities the caller can view', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'CUSTOMER_VIEW', 'ITEM_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    const entities = (call[2] as { entities: string[] }).entities;
    expect(entities).toEqual(expect.arrayContaining(['customer', 'item']));
    // No permission for these was granted, so they must be excluded.
    expect(entities).not.toContain('employee');
    expect(entities).not.toContain('account');
    // No INVOICE_VIEW/PO_VIEW held, so attachment (partial parent-type visibility) is
    // excluded from the untyped search entirely — see the attachment-specific tests below.
    expect(entities).not.toContain('attachment');
    await app.close();
  });

  it('a caller with no entity-view permissions beyond SEARCH_GLOBAL gets an empty entity list, not an error', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL'] }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    const entities = (call[2] as { entities: string[] }).entities;
    expect(entities).toEqual([]);
    await app.close();
  });
});

describe('Global Search Phase 1 (patched) — attachment RBAC by parent-record type', () => {
  it('GET /search?entity=attachment with none of INVOICE_VIEW/PO_VIEW → 403, engine never called', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=invoice.pdf&entity=attachment',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL'] }),
    });

    expect(res.statusCode).toBe(403);
    expect(engine.search).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /search?entity=attachment with only INVOICE_VIEW → 200, filtered to INVOICE parent type only', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=invoice.pdf&entity=attachment',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    expect(engine.search).toHaveBeenCalledWith(
      1,
      'invoice.pdf',
      expect.objectContaining({ entity: 'attachment', attachmentEntityTypes: ['INVOICE'] })
    );
    await app.close();
  });

  it('PO_VIEW alone unlocks only PURCHASE_ORDER attachments, not GRN (each parent type has its own permission)', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=po.pdf&entity=attachment',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'PO_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[2] as { attachmentEntityTypes: string[] }).attachmentEntityTypes).toEqual(['PURCHASE_ORDER']);
    await app.close();
  });

  it('GRN_VIEW alone unlocks GRN attachments (purchase-service now checks GRN_VIEW for GRN attachments specifically)', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=grn.pdf&entity=attachment',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'GRN_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[2] as { attachmentEntityTypes: string[] }).attachmentEntityTypes).toEqual(['GRN']);
    await app.close();
  });

  it('untyped global search excludes attachment unless the caller can see every parent type', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW', 'CUSTOMER_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    const entities = (call[2] as { entities: string[] }).entities;
    expect(entities).not.toContain('attachment');
    await app.close();
  });

  it('untyped global search includes attachment, unfiltered, once the caller holds every parent-type permission', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW', 'PO_VIEW', 'GRN_VIEW'] }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    const entities = (call[2] as { entities: string[] }).entities;
    expect(entities).toContain('attachment');
    await app.close();
  });
});

describe('Global Search Phase 1 — branch-scope filtering', () => {
  it('a branch-restricted caller searching a branch-scoped entity gets a branchIds filter', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=INV-100&entity=invoice',
      headers: authHeader({ tenantId: 1, permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW'], branchIds: [3, 7] }),
    });

    expect(res.statusCode).toBe(200);
    expect(engine.search).toHaveBeenCalledWith(
      1,
      'INV-100',
      expect.objectContaining({ entity: 'invoice', branchIds: [3, 7] })
    );
    await app.close();
  });

  it('BRANCH_SCOPE_BYPASS means no branchIds filter is applied', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=INV-100&entity=invoice',
      headers: authHeader({
        tenantId: 1,
        permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW', 'BRANCH_SCOPE_BYPASS'],
        branchIds: [3],
      }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[2] as { branchIds?: number[] }).branchIds).toBeUndefined();
    await app.close();
  });

  it('global search excludes branch-scoped entities entirely for a branch-restricted caller', async () => {
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await searchRoutes(app, engine);

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: authHeader({
        tenantId: 1,
        permissions: ['SEARCH_GLOBAL', 'INVOICE_VIEW', 'CUSTOMER_VIEW'],
        branchIds: [3],
      }),
    });

    expect(res.statusCode).toBe(200);
    const call = (engine.search as ReturnType<typeof vi.fn>).mock.calls[0];
    const entities = (call[2] as { entities: string[] }).entities;
    // customer isn't branch-scoped, so it stays; invoice is branch-scoped, so it's dropped
    // from the untyped global search even though the caller holds INVOICE_VIEW.
    expect(entities).toContain('customer');
    expect(entities).not.toContain('invoice');
    await app.close();
  });
});
