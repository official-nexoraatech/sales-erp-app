/**
 * PG-015 — event-service's 6 admin-console route files (DLQ, Saga, Schema Registry,
 * Projections, Event Store, Performance) used to gate all 24 routes on the broad
 * AUDIT_LOG_VIEW permission. This proves the fix actually changed enforcement:
 * a role holding only the new console-specific constant succeeds, and a role holding
 * only AUDIT_LOG_VIEW (the old, now-wrong, gate) gets 403.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  dlqItems: { id: 'id', topic: 'topic', status: 'status', createdAt: 'created_at' },
  sagaLog: { id: 'id', tenantId: 'tenant_id', status: 'status', sagaType: 'saga_type', sagaId: 'saga_id', updatedAt: 'updated_at' },
  projectionMetadata: { projectionName: 'projection_name', tenantId: 'tenant_id', status: 'status' },
  performanceProfiles: { endpoint: 'endpoint', method: 'method' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  sql: vi.fn(() => '__sql__'),
  desc: vi.fn(() => '__desc__'),
  gte: vi.fn(() => '__gte__'),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn().mockResolvedValue({ id: 'job-1' }) })),
}));

vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@erp/sdk')>();
  return {
    ...actual,
    SchemaRegistry: vi.fn().mockImplementation(() => ({
      getCatalog: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn().mockResolvedValue(null),
      getVersion: vi.fn().mockResolvedValue(null),
      register: vi.fn().mockResolvedValue({}),
      checkCompatibility: vi.fn().mockReturnValue({ compatible: true, incompatibilities: [] }),
    })),
    EventStoreService: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockResolvedValue([]),
      rebuild: vi.fn().mockResolvedValue({}),
    })),
  };
});

import { dlqRoutes } from '../api/dlq.routes.js';
import { sagaRoutes } from '../api/saga.routes.js';
import { schemaRegistryRoutes } from '../api/schema-registry.routes.js';
import { projectionRoutes } from '../api/projections.routes.js';
import { eventStoreRoutes } from '../api/event-store.routes.js';
import { performanceRoutes } from '../api/performance.routes.js';

// Chainable fake db: every drizzle method resolves to an empty array/object so
// handlers complete without throwing, regardless of which chain they build.
function buildFakeDb() {
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit', 'offset', 'orderBy', 'update', 'set', 'insert', 'values']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void) => resolve([]);
  chainable['execute'] = vi.fn().mockResolvedValue([{ count: '0' }]);
  return chainable;
}

const mockCtxFactory = {
  getRedis: () => ({}),
  create: () => ({ db: { raw: buildFakeDb(), transaction: vi.fn() } }),
} as never;

const TEST_TTL = 900;
let privateKey: KeyLike;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TEST_TTL)
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

interface Boundary {
  consoleName: string;
  buildApp: () => Promise<FastifyInstance>;
  method: 'GET' | 'POST';
  url: string;
  viewPermission: string;
  managePermission?: string;
}

const boundaries: Boundary[] = [
  {
    consoleName: 'DLQ (view)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await dlqRoutes(app, mockCtxFactory, { publishRaw: vi.fn() } as never);
      return app;
    },
    method: 'GET',
    url: '/admin/dlq/summary',
    viewPermission: PERMISSIONS.DLQ_VIEW,
  },
  {
    consoleName: 'DLQ (manage)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await dlqRoutes(app, mockCtxFactory, { publishRaw: vi.fn() } as never);
      return app;
    },
    method: 'POST',
    url: '/admin/dlq/some-topic/replay',
    viewPermission: PERMISSIONS.DLQ_MANAGE,
  },
  {
    consoleName: 'Saga Monitor (view)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await sagaRoutes(app, mockCtxFactory, {} as never);
      return app;
    },
    method: 'GET',
    url: '/admin/sagas/summary',
    viewPermission: PERMISSIONS.SAGA_VIEW,
  },
  {
    consoleName: 'Saga Monitor (manage)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await sagaRoutes(app, mockCtxFactory, { compensate: vi.fn().mockResolvedValue({ status: 'COMPENSATED' }) } as never);
      return app;
    },
    method: 'POST',
    url: '/admin/sagas/some-id/compensate',
    viewPermission: PERMISSIONS.SAGA_MANAGE,
  },
  {
    consoleName: 'Schema Registry (view)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await schemaRegistryRoutes(app, mockCtxFactory);
      return app;
    },
    method: 'GET',
    url: '/schema-registry/catalog',
    viewPermission: PERMISSIONS.SCHEMA_REGISTRY_VIEW,
  },
  {
    consoleName: 'Schema Registry (manage)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await schemaRegistryRoutes(app, mockCtxFactory);
      return app;
    },
    method: 'POST',
    url: '/schema-registry/schemas/SOME_EVENT/check',
    viewPermission: PERMISSIONS.SCHEMA_REGISTRY_MANAGE,
  },
  {
    consoleName: 'Projections (view)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await projectionRoutes(app, mockCtxFactory);
      return app;
    },
    method: 'GET',
    url: '/admin/projections',
    viewPermission: PERMISSIONS.PROJECTION_VIEW,
  },
  {
    consoleName: 'Projections (manage)',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await projectionRoutes(app, mockCtxFactory);
      return app;
    },
    method: 'POST',
    url: '/admin/projections/projection_stock_level/heartbeat',
    viewPermission: PERMISSIONS.PROJECTION_MANAGE,
  },
  {
    consoleName: 'Event Store',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await eventStoreRoutes(app, mockCtxFactory);
      return app;
    },
    method: 'GET',
    url: '/admin/events/store',
    viewPermission: PERMISSIONS.EVENT_STORE_VIEW,
  },
  {
    consoleName: 'Performance',
    buildApp: async () => {
      const app = Fastify({ logger: false });
      await performanceRoutes(app, mockCtxFactory);
      return app;
    },
    method: 'GET',
    url: '/admin/performance/baselines',
    viewPermission: PERMISSIONS.PERFORMANCE_VIEW,
  },
];

describe.each(boundaries)('$consoleName permission boundary', ({ buildApp, method, url, viewPermission }) => {
  it(`succeeds with only the console-specific permission (${viewPermission})`, async () => {
    const app = await buildApp();
    const token = await makeToken([viewPermission]);
    const res = await app.inject({ method, url, headers: { Authorization: `Bearer ${token}` } });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);

    await app.close();
  });

  it('returns 403 with only the old AUDIT_LOG_VIEW catch-all', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.AUDIT_LOG_VIEW]);
    const res = await app.inject({ method, url, headers: { Authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(403);

    await app.close();
  });
});
