// Found in live QA 2026-07-17 (mirrors the same bug/fix in sales-service): main.ts
// registered every route file directly on the same shared Fastify `sub` instance (no
// per-file encapsulation). purchaseOrderRoutes' own
// fastify.addHook('preHandler', authenticate) therefore silently applied to every route
// registered on `sub` after it — including searchSyncInternalRoutes, an internal-key-only
// route that was never supposed to require a JWT at all. This 401'd every scheduled
// search-sync/reindex call for purchase_order/grn/purchase_return, every tenant. Fixed by
// registering internal-key-only routes as a genuinely separate top-level sibling
// .register() call — nesting inside the same `sub` does NOT work even if written first in
// source order, since avvio finalizes a parent's full hook chain before any child boots.
// This test reproduces main.ts's real (fixed) registration shape and confirms it holds.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { purchaseOrderRoutes } from '../api/purchase-order.routes.js';
import { internalRoutes } from '../api/internal.routes.js';
import { searchSyncInternalRoutes } from '../api/search-sync.internal.routes.js';

const fakeCtxFactory = {
  create: () => ({ db: { raw: {} } }),
} as unknown as PlatformContextFactory;

async function buildApp() {
  const app = Fastify();
  await app.register(
    async (internalSub) => {
      await internalRoutes(internalSub, fakeCtxFactory);
      await searchSyncInternalRoutes(internalSub, fakeCtxFactory);
    },
    { prefix: '/api/v2' }
  );
  await app.register(
    async (sub) => {
      await purchaseOrderRoutes(sub, fakeCtxFactory);
    },
    { prefix: '/api/v2' }
  );
  await app.ready();
  return app;
}

describe('internal-key routes stay isolated from sibling JWT-auth hooks', () => {
  it('POST /purchase-orders still requires a JWT (unaffected by the fix)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/v2/purchase-orders' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /internal/search-sync/:entity succeeds with only x-internal-key, no JWT', async () => {
    process.env['INTERNAL_API_KEY'] = 'test-internal-key';
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/internal/search-sync/__unknown_entity__?tenantId=2',
      headers: { 'x-internal-key': 'test-internal-key' },
    });
    // 422 (unknown entity) proves the request reached the real route handler at all —
    // the bug this guards against made it 401 before ever getting this far.
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('GET /internal/search-sync/:entity still rejects a missing/wrong x-internal-key', async () => {
    process.env['INTERNAL_API_KEY'] = 'test-internal-key';
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/internal/search-sync/__unknown_entity__?tenantId=2',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
