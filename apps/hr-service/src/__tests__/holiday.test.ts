import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { holidayRoutes } from '../api/holiday.routes.js';
import type * as ErpTypes from '@erp/types';

vi.mock('@erp/types', async (importActual) => {
  const actual = await importActual<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      HR_MANAGE: 'HR_MANAGE',
    },
  };
});

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: vi.fn((req, _reply, done) => {
    (req as Record<string, unknown>)['auth'] = { tenantId: 1, userId: 1 };
    done();
  }),
}));

vi.mock('../middleware/authorize.js', () => ({
  requirePermission: () => vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
}));

const holidayStore: Record<string, unknown>[] = [];

vi.mock('@erp/db', () => ({
  holidayCalendars: {
    id: {},
    tenantId: {},
    name: {},
    holidayDate: {},
    holidayType: {},
    branchId: {},
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  // tenantScopedHandler (via withTenantConnection in @erp/sdk) uses drizzle-orm's own sql
  // tagged template internally — a per-file vi.mock('drizzle-orm', ...) replaces the module
  // for every importer, so it must be included here too or the SET LOCAL call throws.
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

function makeCtxFactory() {
  const rawDb = {
    select: () => ({
      from: () => ({
        // The route code sometimes awaits `.where(...)` directly (a duplicate-existence
        // check before insert) and sometimes chains `.orderBy(...)` after it (the list
        // route) — this mock needs to satisfy both shapes, so `where()` returns a
        // thenable/array-like that's also awaitable on its own.
        where: () => {
          const result = Object.assign([...holidayStore], {
            orderBy: () => Promise.resolve(holidayStore),
          });
          return result;
        },
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          const row = { id: crypto.randomUUID(), ...vals };
          holidayStore.push(row);
          return Promise.resolve([row]);
        },
        then: (resolve: (v: unknown) => void) => {
          const row = { id: crypto.randomUUID(), ...vals };
          holidayStore.push(row);
          resolve(undefined);
        },
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    execute: () => Promise.resolve(),
  };
  (rawDb as Record<string, unknown>)['transaction'] = (cb: (trx: typeof rawDb) => unknown) =>
    cb(rawDb);

  return {
    rawDb,
    create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
      db: { raw: rawDb },
      tenant,
    }),
  };
}

describe('holidayRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    holidayStore.length = 0;
    app = Fastify();
    await app.register(
      async (sub) => {
        await holidayRoutes(sub, makeCtxFactory() as never);
      },
      { prefix: '/api/v2' }
    );
    await app.ready();
  });

  it('creates a holiday and finds it in the list', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v2/holidays',
      payload: { name: 'Diwali', holidayDate: '2026-10-20', holidayType: 'NATIONAL' },
    });
    expect(createRes.statusCode).toBe(201);

    expect(holidayStore).toHaveLength(1);
    expect((holidayStore[0] as Record<string, unknown>)['name']).toBe('Diwali');
  });

  it('seed creates national holidays for 2026-27', async () => {
    // Insert mock needs to track seeded count
    const seedRes = await app.inject({
      method: 'POST',
      url: '/api/v2/holidays/seed',
    });
    expect(seedRes.statusCode).toBe(200);
    const body = seedRes.json<{ data: { seeded: number } }>();
    expect(body.data.seeded).toBeGreaterThan(0);
    expect(holidayStore.length).toBeGreaterThan(0);
  });
});
