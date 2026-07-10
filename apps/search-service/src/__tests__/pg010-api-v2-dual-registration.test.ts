// PG-010: internalRoutes (part of search-service's route tree) had no version prefix
// at all. main.ts now dual-registers it — once unprefixed (legacy, deprecation window)
// and once under /api/v2 (the new baseline convention) — so this asserts both paths are
// reachable. checkInternalKey rejects before ever touching `engine`, so a stub is enough.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { internalRoutes } from '../api/internal.routes.js';

describe('PG-010 — search-service dual /api/v2 + legacy registration', () => {
  it('reaches the same route both unprefixed and under /api/v2', async () => {
    const app = Fastify({ logger: false });
    const engine = {} as SearchEngine;

    await internalRoutes(app, engine);
    await app.register(async (sub) => {
      await internalRoutes(sub, engine);
    }, { prefix: '/api/v2' });

    const legacy = await app.inject({ method: 'POST', url: '/internal/search/reindex/customers', payload: { tenantId: 1 } });
    const v2 = await app.inject({ method: 'POST', url: '/api/v2/internal/search/reindex/customers', payload: { tenantId: 1 } });

    expect(legacy.statusCode).not.toBe(404);
    expect(v2.statusCode).not.toBe(404);
    expect(legacy.statusCode).toBe(v2.statusCode);

    await app.close();
  });
});
