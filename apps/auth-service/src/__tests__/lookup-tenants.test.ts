// G1 (2026-07-16 audit) — org-lookup-by-email step for the login flow's tenant switcher.
//
// Covers:
//   - an email with one ACTIVE account returns that one tenant
//   - an email with accounts in two tenants returns both
//   - an email with no matching account returns an empty list (still 200 — the enumeration
//     trade-off here is accepted deliberately, see lookup-tenants.ts's header comment)

import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('@erp/db', () => ({
  users: { __name: 'users' },
  tenants: { __name: 'tenants' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
}));

import { lookupTenantsRoute } from '../routes/lookup-tenants.js';

const TEST_CONFIG = {
  lookupTenantsRateLimitMax: 20,
  lookupTenantsRateLimitWindowMs: 300_000,
};

function makeDb(rows: unknown[]): { select: ReturnType<typeof vi.fn> } {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

async function buildApp(db: ReturnType<typeof makeDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await lookupTenantsRoute(app, db as never, TEST_CONFIG as never);
  return app;
}

describe('POST /auth/lookup-tenants', () => {
  it('returns the single ACTIVE tenant an email has an account in', async () => {
    const db = makeDb([{ tenantId: 7, name: 'Acme Textiles', slug: 'acme' }]);
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/lookup-tenants',
      payload: { email: 'ada@acme.example' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { tenants: unknown[] } };
    expect(body.data.tenants).toEqual([{ tenantId: 7, name: 'Acme Textiles', slug: 'acme' }]);
    await app.close();
  });

  it('returns every ACTIVE tenant an email has an account in', async () => {
    const db = makeDb([
      { tenantId: 7, name: 'Acme Textiles', slug: 'acme' },
      { tenantId: 9, name: 'Acme Retail', slug: 'acme-retail' },
    ]);
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/lookup-tenants',
      payload: { email: 'ada@acme.example' },
    });

    const body = JSON.parse(res.body) as { data: { tenants: unknown[] } };
    expect(body.data.tenants).toHaveLength(2);
    await app.close();
  });

  it('returns an empty list (still 200) when no account matches', async () => {
    const db = makeDb([]);
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/lookup-tenants',
      payload: { email: 'nobody@nowhere.example' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { tenants: unknown[] } };
    expect(body.data.tenants).toEqual([]);
    await app.close();
  });

  it('rejects an invalid email with 400', async () => {
    const db = makeDb([]);
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/lookup-tenants',
      payload: { email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
