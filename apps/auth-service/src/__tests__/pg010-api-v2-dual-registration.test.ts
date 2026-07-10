// PG-010: auth-service had no version prefix at all. main.ts now dual-registers its
// routes — once unprefixed (legacy, deprecation window) and once under /api/v2 (the new
// baseline convention) — so this asserts both paths are reachable, mirroring main.ts's
// registration shape without needing its full DB/Redis/JWT bootstrap.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { searchSyncInternalRoutes } from '../routes/search-sync.internal.routes.js';

describe('PG-010 — auth-service dual /api/v2 + legacy registration', () => {
  it('reaches the same route both unprefixed and under /api/v2', async () => {
    const app = Fastify({ logger: false });
    const db = {} as ErpDatabase;

    await searchSyncInternalRoutes(app, db);
    await app.register(async (sub) => {
      await searchSyncInternalRoutes(sub, db);
    }, { prefix: '/api/v2' });

    const legacy = await app.inject({ method: 'GET', url: '/internal/search-sync/customers?tenantId=1' });
    const v2 = await app.inject({ method: 'GET', url: '/api/v2/internal/search-sync/customers?tenantId=1' });

    expect(legacy.statusCode).not.toBe(404);
    expect(v2.statusCode).not.toBe(404);
    expect(legacy.statusCode).toBe(v2.statusCode);

    await app.close();
  });
});
