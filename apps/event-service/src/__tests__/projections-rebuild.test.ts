/**
 * PG-008 — POST /admin/projections/:name/rebuild enqueues a real BullMQ job onto
 * scheduler-service's JobRegistry queue instead of the old setTimeout simulation.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  projectionMetadata: {
    projectionName: 'projection_name',
    tenantId: 'tenant_id',
    status: 'status',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  sql: vi.fn(() => '__sql__'),
}));

const addMock = vi.fn();
const queueConstructorCalls: string[] = [];

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((queueName: string) => {
    queueConstructorCalls.push(queueName);
    return { add: addMock };
  }),
}));

import { projectionRoutes } from '../api/projections.routes.js';

// Same scripted-chainable pattern as purchase-return-ledger.test.ts: canned
// responses per await point, in call order, rather than a real filtering DB.
function buildFakeDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit', 'update', 'set']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

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

function buildMockCtxFactory(script: unknown[]) {
  return {
    getRedis: () => ({}),
    create: () => ({ db: { raw: buildFakeDb(script) } }),
  } as never;
}

async function buildApp(script: unknown[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await projectionRoutes(app, buildMockCtxFactory(script));
  return app;
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

afterEach(() => {
  addMock.mockReset();
  queueConstructorCalls.length = 0;
});

// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/projections/:name/rebuild', () => {
  it('enqueues onto the correct BullMQ queue and marks REBUILDING', async () => {
    addMock.mockResolvedValue({ id: 'job-1' });
    const script = [
      [{ projectionName: 'projection_customer_balance', status: 'UP_TO_DATE' }], // select ... limit(1)
      undefined, // update -> REBUILDING
    ];
    const app = await buildApp(script);

    const token = await makeToken([PERMISSIONS.PROJECTION_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/projections/projection_customer_balance/rebuild',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body) as { data: { projectionName: string; status: string } };
    expect(body.data).toEqual({
      projectionName: 'projection_customer_balance',
      status: 'REBUILDING',
      message: 'Rebuild initiated',
    });
    expect(queueConstructorCalls).toContain('projection-rebuild-customer-balance');
    expect(addMock).toHaveBeenCalledWith('projection_customer_balance', { tenantId: 1 });

    await app.close();
  });

  it('rejects with 422 when the projection is already REBUILDING, without enqueueing', async () => {
    const script = [
      [{ projectionName: 'projection_stock_level', status: 'REBUILDING' }], // select ... limit(1)
    ];
    const app = await buildApp(script);

    const token = await makeToken([PERMISSIONS.PROJECTION_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/projections/projection_stock_level/rebuild',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(422);
    expect(addMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects with 400 for a projection name with no registered rebuild queue', async () => {
    const script = [
      [{ projectionName: 'projection_customer_aging', status: 'UP_TO_DATE' }], // select ... limit(1)
    ];
    const app = await buildApp(script);

    const token = await makeToken([PERMISSIONS.PROJECTION_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/projections/projection_customer_aging/rebuild',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_PROJECTION');
    expect(addMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('marks the projection ERROR and returns 500 when the enqueue itself fails', async () => {
    addMock.mockRejectedValue(new Error('Redis unreachable'));
    const script = [
      [{ projectionName: 'projection_supplier_balance', status: 'UP_TO_DATE' }], // select ... limit(1)
      undefined, // update -> REBUILDING
      undefined, // update -> ERROR
    ];
    const app = await buildApp(script);

    const token = await makeToken([PERMISSIONS.PROJECTION_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/projections/projection_supplier_balance/rebuild',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('REBUILD_ENQUEUE_FAILED');

    await app.close();
  });
});
