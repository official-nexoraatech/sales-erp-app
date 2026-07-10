// Phase 4 — internal-key-gated reindex/bulk-index routes for scheduler-service, which has
// no user JWT to present (unlike /admin/search/* which stays authenticate+SEARCH_REINDEX
// gated for human/admin use).
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { internalRoutes } from '../api/internal.routes.js';

const ORIGINAL_KEY = process.env['INTERNAL_API_KEY'];

function makeEngine(): SearchEngine {
  return {
    fullReindex: vi.fn().mockResolvedValue({ indexed: 2, failed: 0 }),
    bulkIndex: vi.fn().mockResolvedValue({ indexed: 1, failed: 0 }),
  } as unknown as SearchEngine;
}

describe('search-service internal reindex/bulk-index routes', () => {
  it('POST /internal/search/reindex/:entity without the internal key → 401', async () => {
    process.env['INTERNAL_API_KEY'] = 'correct-key';
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await internalRoutes(app, engine);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/search/reindex/customer',
      payload: { tenantId: 1, documents: [] },
    });

    expect(res.statusCode).toBe(401);
    expect(engine.fullReindex).not.toHaveBeenCalled();
    await app.close();
    process.env['INTERNAL_API_KEY'] = ORIGINAL_KEY;
  });

  it('POST /internal/search/reindex/:entity with the correct key reindexes the given documents', async () => {
    process.env['INTERNAL_API_KEY'] = 'correct-key';
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await internalRoutes(app, engine);

    const documents = [{ id: '1', doc: { name: 'A' } }, { id: '2', doc: { name: 'B' } }];
    const res = await app.inject({
      method: 'POST',
      url: '/internal/search/reindex/customer',
      headers: { 'x-internal-key': 'correct-key' },
      payload: { tenantId: 5, documents },
    });

    expect(res.statusCode).toBe(200);
    expect(engine.fullReindex).toHaveBeenCalledWith(5, 'customer', expect.any(Function));
    await app.close();
    process.env['INTERNAL_API_KEY'] = ORIGINAL_KEY;
  });

  it('POST /internal/search/reindex/:entity rejects an unknown entity with 422', async () => {
    process.env['INTERNAL_API_KEY'] = 'correct-key';
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await internalRoutes(app, engine);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/search/reindex/not-a-real-entity',
      headers: { 'x-internal-key': 'correct-key' },
      payload: { tenantId: 5, documents: [] },
    });

    expect(res.statusCode).toBe(422);
    expect(engine.fullReindex).not.toHaveBeenCalled();
    await app.close();
    process.env['INTERNAL_API_KEY'] = ORIGINAL_KEY;
  });

  it('POST /internal/search/bulk-index with the correct key upserts without dropping the index', async () => {
    process.env['INTERNAL_API_KEY'] = 'correct-key';
    const engine = makeEngine();
    const app = Fastify({ logger: false });
    await internalRoutes(app, engine);

    const documents = [{ id: '1', doc: { status: 'SENT' } }];
    const res = await app.inject({
      method: 'POST',
      url: '/internal/search/bulk-index',
      headers: { 'x-internal-key': 'correct-key' },
      payload: { tenantId: 5, entity: 'quotation', documents },
    });

    expect(res.statusCode).toBe(200);
    expect(engine.bulkIndex).toHaveBeenCalledWith(5, 'quotation', documents);
    await app.close();
    process.env['INTERNAL_API_KEY'] = ORIGINAL_KEY;
  });
});
