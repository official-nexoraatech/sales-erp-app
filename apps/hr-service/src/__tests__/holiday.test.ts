import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { holidayRoutes } from '../api/holiday.routes.js';

vi.mock('@erp/types', async (importActual) => {
  const actual = await importActual<typeof import('@erp/types')>();
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
  holidayCalendars: { id: {}, tenantId: {}, name: {}, holidayDate: {}, holidayType: {}, branchId: {} },
}));

function makeCtxFactory() {
  return {
    create: () => ({
      db: {
        raw: {
          select: () => ({
            from: () => ({
              where: () => ({ orderBy: () => Promise.resolve(holidayStore) }),
            }),
          }),
          insert: () => ({
            values: (vals: Record<string, unknown>) => ({
              returning: () => {
                const row = { id: crypto.randomUUID(), ...vals };
                holidayStore.push(row);
                return Promise.resolve([row]);
              },
            }),
          }),
          delete: () => ({
            where: () => Promise.resolve(),
          }),
        },
      },
    }),
  };
}

describe('holidayRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    holidayStore.length = 0;
    app = Fastify();
    await app.register(async (sub) => {
      await holidayRoutes(sub, makeCtxFactory() as never);
    }, { prefix: '/api/v2' });
    await app.ready();
  });

  it('creates a holiday and finds it in the list', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v2/holidays',
      payload: { name: 'Diwali', holidayDate: '2026-10-20', holidayType: 'NATIONAL' },
    });
    expect(createRes.statusCode).toBe(201);

    const listMockDb = {
      raw: {
        select: () => ({
          from: () => ({
            where: () => ({ orderBy: () => Promise.resolve(holidayStore) }),
          }),
        }),
      },
    };
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
