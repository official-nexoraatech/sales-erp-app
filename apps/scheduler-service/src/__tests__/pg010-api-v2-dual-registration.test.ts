// PG-010: schedulerRoutes had no version prefix at all. main.ts now dual-registers it —
// once unprefixed (legacy, deprecation window) and once under /api/v2 (the new baseline
// convention) — so this asserts both paths are reachable. GET /jobs's `authenticate`
// preHandler rejects before ever touching `registry`, so a stub is enough here.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { ErpDatabase } from '@erp/db';
import type { JobRegistry } from '../JobRegistry.js';
import { schedulerRoutes } from '../api/scheduler.routes.js';

describe('PG-010 — scheduler-service dual /api/v2 + legacy registration', () => {
  it('reaches the same route both unprefixed and under /api/v2', async () => {
    const app = Fastify({ logger: false });
    const db = {} as ErpDatabase;
    const registry = {} as JobRegistry;

    await schedulerRoutes(app, db, registry);
    await app.register(async (sub) => {
      await schedulerRoutes(sub, db, registry);
    }, { prefix: '/api/v2' });

    const legacy = await app.inject({ method: 'GET', url: '/jobs' });
    const v2 = await app.inject({ method: 'GET', url: '/api/v2/jobs' });

    expect(legacy.statusCode).not.toBe(404);
    expect(v2.statusCode).not.toBe(404);
    expect(legacy.statusCode).toBe(v2.statusCode);

    await app.close();
  });
});
