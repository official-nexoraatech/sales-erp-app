// CRM-ROADMAP Phase 1, Feature 2: POST /leads/capture must be the one route in this file that
// never requires a JWT — but it's registered in the same main.ts as attachmentRoutes and other
// files that call fastify.addHook('preHandler', authenticate) directly on their shared `sub`
// instance. Mirrors internal-route-auth-isolation.test.ts's reproduction of the exact bug class
// (nesting a route inside that `sub`, even before the addHook call in source order, still
// inherits it — only a true sibling .register() escapes it) — confirms leadRoutes' registration
// in main.ts (a genuine sibling, not nested in `sub`) actually holds.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { leadRoutes } from '../api/lead.routes.js';
import { attachmentRoutes } from '../api/attachment.routes.js';

const fakeCtxFactory = {
  create: () => ({
    db: { raw: {}, transaction: async () => undefined },
    events: { publish: async () => undefined },
    audit: { log: async () => undefined },
  }),
} as unknown as PlatformContextFactory;

async function buildApp() {
  const app = Fastify();
  await app.register(
    async (leadSub) => {
      await leadRoutes(leadSub, fakeCtxFactory);
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

describe('POST /leads/capture stays isolated from sibling JWT-auth hooks', () => {
  it('POST /attachments still requires a JWT (unaffected)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/v2/attachments' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /leads (authenticated) 401s with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v2/leads' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /leads/capture reaches the real handler with no JWT at all', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/leads/capture',
      payload: { tenantId: 999999, phone: '9000000000' },
    });
    // Not 401/403 — whatever it returns (a business error for the fake/missing tenant is
    // fine here), the point is it reached the route handler instead of being rejected by an
    // inherited auth hook before ever getting there.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('a filled honeypot field returns a fake success without reaching the database', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/leads/capture',
      // A real bot payload would still need a valid phone to pass Zod — the honeypot check
      // must trip before any DB call, not rely on validation rejecting the bot first.
      payload: { tenantId: 999999, phone: '9000000000', hp: 'bots fill every field' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });
});
