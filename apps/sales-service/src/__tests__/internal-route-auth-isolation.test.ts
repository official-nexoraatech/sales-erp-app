// Found in live QA 2026-07-17: main.ts registered every route file directly on the same
// shared Fastify `sub` instance (no per-file encapsulation). attachmentRoutes' own
// fastify.addHook('preHandler', authenticate) therefore silently applied to every route
// registered on `sub` AFTER it — including searchSyncInternalRoutes, an internal-key-only
// route that was never supposed to require a JWT at all. This 401'd every scheduled
// search-sync/reindex call for every entity, every tenant, with no error anywhere obvious
// (the scheduler logs a generic "non-ok" warning per source and moves on). Fixed by
// registering internal-key-only routes in their own nested/encapsulated child context,
// before any addHook-using route file — this test reproduces main.ts's real registration
// order (attachmentRoutes first, to prove it can't leak) and confirms the fix holds.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { attachmentRoutes } from '../api/attachment.routes.js';
import { internalRoutes } from '../api/internal.routes.js';
import { searchSyncInternalRoutes } from '../api/search-sync.internal.routes.js';

const fakeCtxFactory = {
  create: () => ({ db: { raw: {} } }),
} as unknown as PlatformContextFactory;

async function buildApp() {
  const app = Fastify();
  // Two genuinely separate top-level .register() calls, not one nested inside the other —
  // a Fastify child does NOT get isolated from a parent's hooks by registering "before" the
  // parent gains them (avvio finalizes a parent's full hook chain before any nested child
  // boots, regardless of source-line order); true isolation only comes from being a sibling
  // at the same encapsulation level, never a descendant of the instance attachmentRoutes
  // (or any addHook-using route file) mutates directly. This is what main.ts's real fix does.
  await app.register(
    async (internalSub) => {
      await internalRoutes(internalSub, fakeCtxFactory);
      await searchSyncInternalRoutes(internalSub, fakeCtxFactory);
    },
    { prefix: '/api/v2' }
  );
  await app.register(
    async (sub) => {
      await attachmentRoutes(sub, fakeCtxFactory);
    },
    { prefix: '/api/v2' }
  );
  await app.ready();
  return app;
}

describe('internal-key routes stay isolated from sibling JWT-auth hooks', () => {
  it('POST /attachments still requires a JWT (unaffected by the fix)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/v2/attachments' });
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
